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
  // NEU:
  lastReadPage: number;           // Lesefortschritt
  lastReadAt: Date | null;        // Zeitstempel letzte Lesesitzung
  readingTimeSeconds: number;     // Gesamte Lesezeit
  sourceType: 'opfs' | 'folder';  // Woher kommt die Datei?
  folderRelativePath?: string;    // Relativer Pfad im Quell-Ordner
  tags?: string[];                // Optionale Tags für Dashboard-Filter
}

export interface CitationRecord {
  documentId: string;
  marker: string; // z.B. "[12]" oder "(Smith et al., 2024)"
  title: string;
  authors: string[];
  abstract?: string;
}

export interface AnnotationRecord {
  id: string;                     // UUID
  documentId: string;
  pageNumber: number;
  type: 'highlight' | 'comment' | 'bookmark';
  color: string;                  // z.B. '#FFEB3B'
  // PDF-Koordinaten (unscaled viewport):
  rects: { x: number; y: number; w: number; h: number }[];
  selectedText?: string;          // Der markierte Textinhalt
  comment?: string;               // Freitext-Kommentar
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteRecord {
  id: string;                     // UUID
  documentId: string;
  title: string;
  content: string;                // Markdown
  linkedAnnotationIds: string[];  // Referenzen auf Annotations
  linkedPage?: number;            // Optional: Seitenreferenz
  createdAt: Date;
  updatedAt: Date;
}

export class StudyNetDatabase extends Dexie {
  documents!: Table<DocumentRecord, string>;
  // WICHTIG: Primary Key ist ein Array aus [string, string]
  citations!: Table<CitationRecord, [string, string]>; 
  annotations!: Table<AnnotationRecord, string>;
  notes!: Table<NoteRecord, string>;

  constructor() {
    super('StudyNetDB');
    this.version(3).stores({
      documents: 'id, doi, title, addedAt', // Nur Metadaten indizieren
      citations: '[documentId+marker], documentId' // Compound-Index für schnelles Lazy-Fetching
    });

    this.version(4).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType',
      citations: '[documentId+marker], documentId',
      annotations: 'id, documentId, pageNumber, type, createdAt',
      notes: 'id, documentId, createdAt, updatedAt',
    }).upgrade(tx => {
      return tx.table('documents').toCollection().modify(doc => {
        if (doc.lastReadPage === undefined) doc.lastReadPage = 1;
        if (doc.lastReadAt === undefined) doc.lastReadAt = null;
        if (doc.readingTimeSeconds === undefined) doc.readingTimeSeconds = 0;
        if (doc.sourceType === undefined) doc.sourceType = 'opfs';
      });
    });
  }
}

export const db = new StudyNetDatabase();
