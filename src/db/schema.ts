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
