import * as pdfjsLib from 'pdfjs-dist';
import MiniSearch from 'minisearch';
import { normalizeLigaturesAndFontArtifacts } from '../utils/textNormalization';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface TextSpanInfo {
  startChar: number;
  endChar: number;
  rect: { x: number; y: number; w: number; h: number } | null;
}

export interface CitationHitbox {
  marker: string;
  rects: { x: number; y: number; w: number; h: number }[];
  pageNumber?: number;
}

/**
 * Calculate precise sub-rectangles for a character substring range
 */
function calculateSubRects(
  spanIndexMap: TextSpanInfo[],
  targetStart: number,
  targetEnd: number
): { x: number; y: number; w: number; h: number }[] {
  const rects: { x: number; y: number; w: number; h: number }[] = [];

  for (const span of spanIndexMap) {
    if (!span.rect) continue;

    // Check if span overlaps with target character range
    if (span.endChar > targetStart && span.startChar < targetEnd) {
      const spanLen = span.endChar - span.startChar;
      if (spanLen <= 0) continue;

      const localStart = Math.max(0, targetStart - span.startChar);
      const localEnd = Math.min(spanLen, targetEnd - span.startChar);

      if (localEnd > localStart) {
        const charWidth = span.rect.w / spanLen;
        const subX = span.rect.x + localStart * charWidth;
        const subW = Math.max((localEnd - localStart) * charWidth, 4);
        const subY = span.rect.y;
        const subH = span.rect.h;

        // Add padding to make hover smoother
        rects.push({
          x: Math.max(0, subX - 1),
          y: Math.max(0, subY - 1),
          w: subW + 2,
          h: subH + 2,
        });
      }
    }
  }

  return rects;
}

export function extractCitationHitboxes(
  textContent: any,
  viewport: any,
  pageNum: number
): { hitboxes: CitationHitbox[]; fullText: string; isRefSection: boolean } {
  let fullText = '';
  const spanIndexMap: TextSpanInfo[] = [];
  let lastX = 0;
  let lastY = -1;
  let lastFontSize = 10;

  for (const item of textContent.items) {
    if (!('str' in item) || item.str.length === 0) continue;

    const tx = item.transform;
    const fontSize = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3])) || 10;
    
    // Die y-Koordinate (tx[5]) in PDF.js ist die "Baseline" (Grundlinie) des Textes.
    // Wenn wir die Hitbox von Baseline bis Baseline+fontSize zeichnen, ist sie vertikal nach oben verschoben,
    // weil wir den Bereich unter der Baseline (Descent, z.B. bei p, y, g) nicht abdecken und stattdessen oben überstehen.
    // Wir nehmen an: Ascent ≈ 80% der Schriftgröße, Descent ≈ 20% der Schriftgröße.
    const descent = fontSize * 0.2;
    const ascent = fontSize * 0.8;

    // pt1: bottom-left (inkl. descent), pt2: top-right (inkl. ascent)
    const pt1 = [tx[4], tx[5] - descent];
    const pt2 = [tx[4] + item.width, tx[5] + ascent];

    const viewPt1 = viewport.convertToViewportPoint(pt1[0], pt1[1]);
    const viewPt2 = viewport.convertToViewportPoint(pt2[0], pt2[1]);

    const x = Math.min(viewPt1[0], viewPt2[0]);
    const y = Math.min(viewPt1[1], viewPt2[1]);
    const w = Math.abs(viewPt2[0] - viewPt1[0]);
    const h = Math.abs(viewPt2[1] - viewPt1[1]);

    // Check if new line
    const isNewLine = lastY !== -1 && Math.abs(y - lastY) > h * 0.7;
    // Verbessertes Spacing: Schwellenwert ca. 18% der Schriftgröße (statt 150% der Zeichenbreite)
    let hasSpaceGap = lastX > 0 && x - lastX > Math.max(1.2, fontSize * 0.18);

    // Heuristik für Subskripte/Superskripte synchron zu textNormalization.ts
    if (hasSpaceGap && fullText.length > 0) {
      const isSubscript = fontSize < lastFontSize * 0.9;
      const isReturnFromSubscript = fontSize > lastFontSize * 1.1;
      
      // Nur anwenden, wenn der physische Abstand nicht gewaltig ist (echter Tab/Abstand)
      if (x - lastX < fontSize * 1.0) {
        if (isSubscript && /^[0-9]+$/.test(item.str)) {
          // Prüfe, ob vorheriger Text auf einen Buchstaben endet (z.B. O, Al)
          if (/[a-zA-Z]$/.test(fullText.trimEnd())) {
            hasSpaceGap = false;
          }
        } else if (isReturnFromSubscript && /^[a-zA-Z]+$/.test(item.str)) {
          // Rücksprung: Vorher war eine Zahl, jetzt kommt ein Buchstabe (z.B. O nach 2)
          if (/[0-9]$/.test(fullText.trimEnd())) {
            hasSpaceGap = false;
          }
        }
      }
    }

    if (isNewLine || hasSpaceGap) {
      fullText += ' ';
      spanIndexMap.push({
        startChar: fullText.length - 1,
        endChar: fullText.length,
        rect: null,
      });
    }

    const cleanedStr = normalizeLigaturesAndFontArtifacts(item.str);
    const startChar = fullText.length;
    fullText += cleanedStr;
    const endChar = fullText.length;

    spanIndexMap.push({
      startChar,
      endChar,
      rect: { x, y, w, h },
    });

    lastX = x + w;
    lastY = y;
    lastFontSize = fontSize;
  }

  const isRefSection = /\b(REFERENCES|References|BIBLIOGRAPHY|Bibliography)\b/.test(fullText);

  // Erkenne beliebige Trennzeichen (Kommata, alle Arten von Strichen, Spaces, Encoding-Fehler wie ±) zwischen Zahlen
  const citationRegex = /\[\s*(\d+(?:\s*[^\w\[\]]+\s*\d+)*)\s*\]|\(\s*(?:[A-Za-z\s]+ et al\.,\s*\d{4})\s*\)/g;
  const hitboxes: CitationHitbox[] = [];
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(fullText)) !== null) {
    const matchStart = match.index;
    const fullMatchText = match[0];

    if (fullMatchText.startsWith('[')) {
      // For brackets like [5, 19-21], extract explicit numbers and implicit range numbers
      const partRegex = /(\d+)(\s*[^\w\d\[\]]+\s*)(\d+)?/g;
      let partMatch: RegExpExecArray | null;
      let lastIndex = 0;
      
      // Um alle Zahlen zu finden, nutzen wir weiterhin \d+, aber prüfen auf Ranges
      const numRegex = /\d+/g;
      let numMatch: RegExpExecArray | null;
      const explicitNumbers: { str: string, start: number, end: number }[] = [];
      
      while ((numMatch = numRegex.exec(fullMatchText)) !== null) {
        explicitNumbers.push({
          str: numMatch[0],
          start: matchStart + numMatch.index,
          end: matchStart + numMatch.index + numMatch[0].length
        });
      }

      for (let i = 0; i < explicitNumbers.length; i++) {
        const current = explicitNumbers[i];
        
        // Füge Hitbox für die sichtbare Zahl hinzu
        const exactRects = calculateSubRects(spanIndexMap, current.start, current.end);
        if (exactRects.length > 0) {
          hitboxes.push({ marker: `[${current.str}]`, rects: exactRects, pageNumber: pageNum });
        }

        // Prüfe, ob es eine Range zur nächsten Zahl gibt (z.B. durch ein Bindestrich-ähnliches Zeichen)
        if (i < explicitNumbers.length - 1) {
          const next = explicitNumbers[i + 1];
          const separatorStart = current.end - matchStart;
          const separatorEnd = next.start - matchStart;
          const separatorText = fullMatchText.substring(separatorStart, separatorEnd);
          
          // Wenn der Separator ein Range-Indikator ist (-, –, —, ±, etc. aber kein normales Komma/Semikolon)
          if (separatorText.match(/[-–—±−]/) && !separatorText.includes(',')) {
            const startNum = parseInt(current.str, 10);
            const endNum = parseInt(next.str, 10);
            
            if (startNum < endNum && endNum - startNum < 20) {
              // Extrahiere das Rect für den Separator (den Bindestrich)
              const sepRects = calculateSubRects(spanIndexMap, matchStart + separatorStart, matchStart + separatorEnd);
              
              // Erzeuge Hitboxen für alle "versteckten" Zahlen (z.B. 20 bei 19-21) genau über dem Separator
              if (sepRects.length > 0) {
                for (let hidden = startNum + 1; hidden < endNum; hidden++) {
                  hitboxes.push({
                    marker: `[${hidden}]`,
                    rects: sepRects,
                    pageNumber: pageNum,
                  });
                }
              }
            }
          }
        }
      }
    } else {
      // Author citation e.g. (Smith et al., 2024)
      const exactRects = calculateSubRects(spanIndexMap, matchStart, matchStart + fullMatchText.length);
      if (exactRects.length > 0) {
        hitboxes.push({
          marker: fullMatchText,
          rects: exactRects,
          pageNumber: pageNum,
        });
      }
    }
  }

  return { hitboxes, fullText, isRefSection };
}

function createMiniSearch() {
  return new MiniSearch({
    fields: ['text'],
    storeFields: ['pageNumber', 'text', 'documentId'],
    searchOptions: {
      boost: { text: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'PROCESS_PDF') {
    const { documentId, pdfData } = payload;
    try {
      const loadingTask = pdfjsLib.getDocument({ 
        data: pdfData,
        verbosity: 0
      });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      const hitboxesByPage: Record<number, CitationHitbox[]> = {};
      const pageTexts: Record<number, string> = {};
      const allExtractedMarkers: string[] = [];
      let bibliographyStartPage: number | null = null;

      const miniSearch = createMiniSearch();
      const docsToIndex = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });

        const { hitboxes, fullText, isRefSection } = extractCitationHitboxes(textContent, viewport, pageNum);
        hitboxesByPage[pageNum] = hitboxes;
        pageTexts[pageNum] = fullText;

        if (isRefSection && bibliographyStartPage === null) {
          bibliographyStartPage = pageNum;
        }

        hitboxes.forEach((h) => {
          if (!allExtractedMarkers.includes(h.marker)) {
            allExtractedMarkers.push(h.marker);
          }
        });

        docsToIndex.push({
          id: `${documentId}_${pageNum}`,
          pageNumber: pageNum,
          text: fullText,
          documentId,
        });

        self.postMessage({
          type: 'PROCESS_PROGRESS',
          payload: {
            documentId,
            current: pageNum,
            total: numPages,
          },
        });
      }

      miniSearch.addAll(docsToIndex);
      const searchIndexJson = JSON.stringify(miniSearch);

      self.postMessage({
        type: 'PROCESS_SUCCESS',
        payload: {
          documentId,
          numPages,
          hitboxes: hitboxesByPage,
          pageTexts,
          extractedMarkers: allExtractedMarkers,
          searchIndexJson,
          bibliographyStartPage: bibliographyStartPage || numPages,
        },
      });
    } catch (error: any) {
      self.postMessage({
        type: 'PROCESS_ERROR',
        payload: {
          documentId,
          error: error?.message || 'Failed to process PDF',
        },
      });
    }
  }
};
