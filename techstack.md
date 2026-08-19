1. Das finale Storage-Konzept (Dexie + OPFS)

Regel: IndexedDB (Dexie) speichert nur Metadaten (schnell durchsuchbar, geringer RAM-Bedarf). Das Origin Private File System (OPFS) speichert alle großen Binärdaten (PDFs und ausgeschnittene Bilder).

// db/schema.ts
import Dexie, { Table } from 'dexie';

export interface DocumentRecord {
  id: string; // UUID
  doi?: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  pdfOpfsPath: string; // Pfad im OPFS, z.B. "opfs://pdfs/paper123.pdf"
  totalPages: number;
  addedAt: Date;
}

export interface CitationRecord {
  documentId: string;
  marker: string; // z.B. "[12]" oder "(Smith et al., 2024)"
  title: string;
  authors: string[];
  abstract?: string;
}

export class StudyNetDatabase extends Dexie {
  documents!: Table<DocumentRecord, string>;
  // WICHTIG: Primary Key ist ein Array aus [string, string]
  citations!: Table<CitationRecord, [string, string]>; 

  constructor() {
    super('StudyNetDB');
    this.version(3).stores({
      documents: 'id, doi, title, addedAt', // Nur Metadaten indizieren
      citations: '[documentId+marker], documentId' // Compound-Index für schnelles Lazy-Fetching
    });
  }
}
export const db = new StudyNetDatabase();


Der OPFS-Hilfsdienst, der sowohl PDFs als auch Snips (Bilder) speichert:

// utils/opfsStorage.ts
export async function saveToOPFS(blob: Blob, directory: string, fileName: string): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const dirHandle = await root.getDirectoryHandle(directory, { create: true });
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  
  return `opfs://${directory}/${fileName}`;
}

export async function getFromOPFS(opfsUrl: string): Promise<File> {
  const parts = opfsUrl.replace('opfs://', '').split('/');
  const directory = parts[0];
  const fileName = parts.slice(1).join('/');
  
  const root = await navigator.storage.getDirectory();
  const dirHandle = await root.getDirectoryHandle(directory);
  const fileHandle = await dirHandle.getFileHandle(fileName);
  return await fileHandle.getFile();
}


Hinweis zur Architektur (Backend-Filling): Damit das Tooltip funktioniert, benötigen wir einen Service (z.B. citationMatchingService.ts). Dieser lädt beim Upload des PDFs die Metadaten via OpenAlex, gleicht sie mit dem Literaturverzeichnis ab, bestimmt den Marker und speichert die Datensätze ({ documentId, marker: '[12]', title: '...', authors: [...] }) in db.citations.

2. Schlanker Zustand-Store (State Management)

Der globale Store enthält ausschließlich die flüchtige Hover-Position und die Referenz-ID. Die schweren Zitationsdaten werden per Cache/Ref vorgehalten oder on-demand aus der IndexedDB abgefragt.

// store/useViewerStore.ts
import { create } from 'zustand';

interface HoverPosition {
  x: number;
  y: number;
}

interface ViewerState {
  activeCitationMarker: string | null;
  hoverPosition: HoverPosition | null;
  setHoveredCitation: (marker: string | null, position?: HoverPosition | null) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  activeCitationMarker: null,
  hoverPosition: null,
  setHoveredCitation: (marker, position = null) =>
    set({ activeCitationMarker: marker, hoverPosition: position }),
}));


3. Der Web Worker (Volltextsuche & Hitbox-Berechnung)

Der Worker nutzt Vite, baut den Suchindex auf und berechnet gleichzeitig die Overlay-Hitboxen. Hier ist die Logik gegen Multi-Zitationen und Autoren-Splitting gesichert.

// workers/pdfProcessor.worker.ts (Auszug)

interface TextSpanInfo {
  startChar: number;
  endChar: number;
  rect: { x: number; y: number; w: number; h: number } | null;
}

// Aufruf im Worker (Viewport MUSS extrahiert werden!)
// const page = await pdf.getPage(pageNum);
// const textContent = await page.getTextContent();
// const viewport = page.getViewport({ scale: 1.0 });
// const pageHitboxes = extractCitationHitboxes(textContent, viewport);

function extractCitationHitboxes(textContent: any, viewport: any) {
  let fullText = '';
  const spanIndexMap: TextSpanInfo[] = [];
  let lastX = 0;
  let lastY = -1; // Für Zeilenumbrüche
  
  const pageHeight = viewport.height; 

  for (const item of textContent.items) {
    if (!('str' in item) || item.str.length === 0) continue;

    const tx = item.transform;
    const x = tx[4];
    const yBottomUp = tx[5]; 
    const w = item.width;
    const h = item.height || Math.abs(tx[0]); 

    // Prüfen, ob wir in einer neuen Zeile sind
    const isNewLine = lastY !== -1 && Math.abs(yBottomUp - lastY) > h * 0.5;

    // Leerzeichen bei großem X-Abstand ODER bei neuer Zeile
    if (isNewLine || (lastX > 0 && (x - lastX) > (w / item.str.length) * 1.5)) {
       fullText += ' ';
       spanIndexMap.push({ startChar: fullText.length - 1, endChar: fullText.length, rect: null });
    }

    const startChar = fullText.length;
    fullText += item.str;
    const endChar = fullText.length;

    const yTopDown = pageHeight - yBottomUp - h;

    spanIndexMap.push({
      startChar,
      endChar,
      rect: { x, y: yTopDown, w, h },
    });

    lastX = x + w;
    lastY = yBottomUp;
  }
  
  const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]|\((?:[A-Za-z]+ et al\., \d{4})\)/g;
  const hitboxes: { marker: string; rects: { x: number; y: number; w: number; h: number }[] }[] = [];
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(fullText)) !== null) {
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    const matchedRects: { x: number; y: number; w: number; h: number }[] = [];

    for (const span of spanIndexMap) {
      if (span.rect && span.endChar > matchStart && span.startChar < matchEnd) {
        matchedRects.push(span.rect);
      }
    }

    if (matchedRects.length > 0) {
      // Prüfen, ob es eine Bracket-Zitation [...] ist, um Autoren-Zitationen nicht kaputt zu machen
      if (match[0].startsWith('[')) {
        const individualNumbers = match[0].match(/\d+/g);
        
        if (individualNumbers) {
          individualNumbers.forEach(num => {
            hitboxes.push({ marker: `[${num}]`, rects: matchedRects });
          });
        }
      } else {
        // Fallback für Autoren-Zitationen (Smith et al., 2024) bleibt unberührt
        hitboxes.push({ marker: match[0], rects: matchedRects });
      }
    }
  }

  return hitboxes;
}


4. Der PDF Viewer (Memory-Safe & Responsive)

Hier binden wir die documentId sauber via Props ein, anstatt uns auf unzuverlässige PDF-Fingerprints zu verlassen.

// components/pdf/VirtualizedPdfViewer.tsx
import React, { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as pdfjsLib from 'pdfjs-dist';
import { CitationOverlayLayer } from './CitationOverlayLayer';
import { CitationTooltip } from './CitationTooltip';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface ViewerProps {
  documentId: string; // NEU: Echte ID statt Fingerprint
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  hitboxes: Record<number, any[]>;
}

export const VirtualizedPdfViewer: React.FC<ViewerProps> = ({ documentId, pdfDocument, hitboxes }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    if (!parentRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width - 40); 
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: pdfDocument.numPages,
    getScrollElement: () => parentRef.current,
    estimateSize: () => containerWidth * 1.4,
    overscan: 2
  });

  return (
    <div ref={parentRef} className="h-full w-full overflow-y-auto bg-neutral-900 p-4">
      <div className="relative w-full mx-auto" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0, left: 0, width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <PdfPageItem
              pdfDocument={pdfDocument}
              pageNumber={virtualRow.index + 1}
              containerWidth={containerWidth}
              pageHitboxes={hitboxes[virtualRow.index + 1] || []}
            />
          </div>
        ))}
      </div>
      
      {/* KORREKTUR: Echte ID an das Overlay weiterreichen */}
      <CitationTooltip documentId={documentId} />
    </div>
  );
};

// ... PdfPageItem bleibt identisch (mit page.cleanup() im unmount) ...


Tooltip mit Array-Syntax (Dexie Compound)

Da wir einen Compound-Index [documentId+marker] nutzen, erwartet Dexie ein Array als Input für die get() Methode.

// components/pdf/CitationTooltip.tsx
import React, { useEffect, useState } from 'react';
import { useViewerStore } from '../../store/useViewerStore';
import { db } from '../../db/schema';

const citationCache = new Map<string, any>();

export const CitationTooltip: React.FC<{ documentId: string }> = ({ documentId }) => {
  const marker = useViewerStore((state) => state.activeCitationMarker);
  const position = useViewerStore((state) => state.hoverPosition);
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    if (!marker) {
      setData(null);
      return;
    }

    const cacheKey = `${documentId}_${marker}`;

    if (citationCache.has(cacheKey)) {
      setData(citationCache.get(cacheKey));
      return;
    }

    let isCurrent = true; // Guard gegen Race-Conditions

    // KORREKTUR: Bei Compound Primary Keys verlangt Dexie ein Array!
    db.citations.get([documentId, marker]).then((res) => {
      if (isCurrent && res) {
        citationCache.set(cacheKey, res);
        setData(res);
      }
    });

    return () => {
      isCurrent = false; // Bricht Setzen des States ab
    };
  }, [marker, documentId]);

  if (!marker || !position || !data) return null;

  return (
    <div
      className="fixed z-50 p-3 bg-neutral-900 text-white rounded-lg shadow-xl border border-neutral-700 pointer-events-none text-xs max-w-sm"
      style={{ top: position.y + 10, left: position.x + 10 }}
    >
      <div className="font-mono text-neutral-400 mb-1">{data.marker}</div>
      <div className="font-semibold text-neutral-100">{data.title}</div>
      <div className="text-neutral-400 italic mt-0.5">{data.authors?.join(', ')}</div>
    </div>
  );
};


5. Service Worker Setup für Vite (OPFS Streaming)

Damit Vite TypeScript im Service Worker kompilieren kann, liegt die Datei in src/sw.ts.

Setup in der main.tsx:

// Nutzt den speziellen Vite-Syntax zum Kompilieren und Laden des Workers
import swUrl from './sw.ts?worker&url';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(swUrl, { type: 'module' });
}


(Alternativ nutzt man das Plugin vite-plugin-pwa in der vite.config.ts, um höchste Browser-Kompatibilität zu garantieren).

// src/sw.ts
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/opfs/')) {
    event.respondWith(handleOpfsRequest(event.request, url.pathname.replace('/opfs/', '')));
  }
});

async function handleOpfsRequest(request: Request, filePath: string): Promise<Response> {
  // ... Dateisystem Handling und Range-Requests wie zuvor definiert ...
}


// components/notes/NoteViewer.tsx (Auszug)
import ReactMarkdown from 'react-markdown';

export const NoteViewer: React.FC<{ content: string }> = ({ content }) => (
  <ReactMarkdown
    components={{
      img: ({ src, alt }) => {
        if (!src) return null;
        
        const cleanSrc = src.startsWith('opfs://') 
          ? src.replace('opfs://', '/opfs/') 
          : src;
          
        return <img src={cleanSrc} alt={alt} className="rounded border max-w-full my-2" loading="lazy" />;
      },
    }}
  >
    {content}
  </ReactMarkdown>
);


6. Finale Projektstruktur

studynet/
├── src/
│   ├── components/
│   │   ├── pdf/
│   │   │   ├── VirtualizedPdfViewer.tsx  # Responsive Canvas Viewer mit documentId Prop
│   │   │   ├── CitationOverlayLayer.tsx  # DOM-Hitbox Rendering
│   │   │   └── CitationTooltip.tsx       # Lazy-Fetch mit Dexie [Array]-Index & Race-Guard
│   │   ├── notes/
│   │   │   └── NoteViewer.tsx            # ReactMarkdown Renderer (wandelt opfs:// um)
│   ├── store/
│   │   └── useViewerStore.ts             # Schlanker Zustand (nur Hover-Position & Marker)
│   ├── services/
│   │   └── citationMatchingService.ts    # [Zukünftiges TODO] Fetch OpenAlex Metadaten -> Dexie
│   ├── utils/
│   │   └── opfsStorage.ts                # Dateisystem-Hilfsfunktionen
│   ├── workers/
│   │   └── pdfProcessor.worker.ts        # MiniSearch-Index & regex-sichere Hitbox-Geometrie
│   ├── db/
│   │   └── schema.ts                     # Dexie DB (Typisierte [Compound] Indizes)
│   ├── sw.ts                         # Vite Service Worker (OPFS Streaming)
│   ├── App.tsx
│   └── main.tsx                      # Bootstrapping & Service Worker Registrierung
├── package.json
└── vite.config.ts
