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
  lastReadPage: number;           // Letzte angezeigte Seite (Resume-Position)
  lastReadAt: Date | null;        // Zeitstempel letzte Lesesitzung
  readingTimeSeconds: number;     // Gesamte Lesezeit
  sourceType: 'opfs' | 'folder';  // Woher kommt die Datei?
  folderRelativePath?: string;    // Relativer Pfad im Quell-Ordner
  tags?: string[];                // Optionale Tags für Dashboard-Filter
  readPages?: number[];           // Eindeutig gelesene Seiten (>= 2s Verweildauer)
  bibliographyStartPage?: number | null; // Startseite des Literaturverzeichnisses
  isCompleted?: boolean;          // Manueller oder erreichter 100%-Status
  tokenUsage?: {                  // Token-Verbrauch der KI-Analyse (Gemini API)
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    model: string;
  };
  syncsyncUpdatedAt?: number;
}

export interface CitationRecord {
  documentId: string;
  marker: string; // z.B. "[12]" oder "(Smith et al., 2024)"
  title: string;
  authors: string[];
  abstract?: string;
  syncUpdatedAt?: number;
}

export interface AnnotationRecord {
  id: string;                     // UUID
  documentId: string;
  pageNumber: number;
  type: 'highlight' | 'comment' | 'bookmark';
  color: string;                  // z.B. '#FFEB3B'
  opacity?: number;               // Deckkraft [0.1, 1.0], Standard ca. 0.35
  // PDF-Koordinaten (unscaled viewport):
  rects: { x: number; y: number; w: number; h: number }[];
  selectedText?: string;          // Der markierte Textinhalt
  comment?: string;               // Freitext-Kommentar
  createdAt: Date;
  updatedAt: Date;
  syncUpdatedAt?: number;
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
  syncsyncUpdatedAt?: number; // Sync Timestamp
}

/** Frage-Kategorie für die semantische Suche */
export type QuestionCategory = 'method' | 'result' | 'material' | 'conclusion' | 'limitation' | 'general';

/**
 * Roher Text-Chunk eines Dokuments, der für spätere Re-Indexierung oder
 * alternative Retrieval-Strategien gespeichert wird.
 */
export interface DocumentChunkRecord {
  id: string;                    // UUID
  documentId: string;            // FK → DocumentRecord.id
  chunkId: string;               // z.B. "chunk_p4_0"
  text: string;                  // Der Rohtext
  pageNumber: number;            // Seitenzahl im PDF
  sequenceIndex: number;         // Reihenfolge im Dokument
  embedding?: number[];          // 384-dim Float-Array (NICHT in Dexie indiziert!)
  createdAt: Date;
  syncsyncUpdatedAt?: number;
}

/**
 * Vom LLM generierte Frage-Antwort-Paare mit Embedding-Vektor.
 * Jede Frage referenziert einen spezifischen Textabschnitt (Chunk) eines Papers.
 */
export interface GeneratedQuestionRecord {
  id: string;                    // UUID
  documentId: string;            // FK → DocumentRecord.id
  question: string;              // Die generierte Frage
  shortAnswer: string;           // 1-2 Satz Kernantwort (ground_truth)
  category: QuestionCategory;    // Frage-Typ für UI-Filter
  chunkId: string;               // z.B. "chunk_p4_0"
  chunkText: string;             // Quell-Textblock für Context Expansion
  pageNumber: number;            // Seitenzahl im PDF
  embedding?: number[];          // 384-dim Float-Array (NICHT in Dexie indiziert!)
  createdAt: Date;
  syncUpdatedAt?: number;
}

// Schema-Änderungen für Sync: updatedAt und DeletedRecord

export interface DeletedRecord {
  id: string;
  tableName: string;
  deletedAt: number;
}

export class StudyNetDatabase extends Dexie {
  documents!: Table<DocumentRecord, string>;
  citations!: Table<CitationRecord, [string, string]>; 
  annotations!: Table<AnnotationRecord, string>;
  notes!: Table<NoteRecord, string>;
  paperQuestions!: Table<GeneratedQuestionRecord, string>;
  documentChunks!: Table<DocumentChunkRecord, string>;
  deleted_records!: Table<DeletedRecord, string>; // NEU

  constructor() {
    super('StudyNetDB');
    this.version(3).stores({
      documents: 'id, doi, title, addedAt',
      citations: '[documentId+marker], documentId'
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

    this.version(5).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType',
      citations: '[documentId+marker], documentId',
      annotations: 'id, documentId, pageNumber, type, createdAt',
      notes: 'id, documentId, createdAt, updatedAt',
      paperQuestions: 'id, documentId, category, pageNumber',
    });

    this.version(6).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType',
      citations: '[documentId+marker], documentId',
      annotations: 'id, documentId, pageNumber, type, createdAt',
      notes: 'id, documentId, createdAt, updatedAt',
      paperQuestions: 'id, documentId, category, pageNumber',
      documentChunks: 'id, documentId, chunkId, sequenceIndex',
    });

    this.version(7).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType',
      citations: '[documentId+marker], documentId',
      annotations: 'id, documentId, pageNumber, type, createdAt',
      notes: 'id, documentId, createdAt, updatedAt',
      paperQuestions: 'id, documentId, category, pageNumber',
      documentChunks: 'id, documentId, chunkId, sequenceIndex',
    });

    this.version(8).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType',
      citations: '[documentId+marker], documentId',
      annotations: 'id, documentId, pageNumber, type, createdAt',
      notes: 'id, documentId, createdAt, updatedAt',
      paperQuestions: 'id, documentId, category, pageNumber',
      documentChunks: 'id, documentId, chunkId, sequenceIndex',
    });

    // Version 9: Sync Support (syncUpdatedAt & deleted_records)
    this.version(9).stores({
      documents: 'id, doi, title, addedAt, lastReadAt, sourceType, syncUpdatedAt',
      citations: '[documentId+marker], documentId, syncUpdatedAt',
      annotations: 'id, documentId, pageNumber, type, createdAt, syncUpdatedAt',
      notes: 'id, documentId, createdAt, updatedAt, syncUpdatedAt',
      paperQuestions: 'id, documentId, category, pageNumber, syncUpdatedAt',
      documentChunks: 'id, documentId, chunkId, sequenceIndex, syncUpdatedAt',
      deleted_records: 'id, tableName, deletedAt'
    }).upgrade(tx => {
      // Alle bestehenden Records mit einem syncUpdatedAt Zeitstempel versehen
      const now = Date.now();
      return Promise.all([
        tx.table('documents').toCollection().modify(record => { record.syncUpdatedAt = record.syncUpdatedAt || now; }),
        tx.table('annotations').toCollection().modify(record => { record.syncUpdatedAt = record.syncUpdatedAt || now; }),
        tx.table('notes').toCollection().modify(record => { record.syncUpdatedAt = record.syncUpdatedAt || now; }),
        tx.table('paperQuestions').toCollection().modify(record => { record.syncUpdatedAt = record.syncUpdatedAt || now; }),
        tx.table('documentChunks').toCollection().modify(record => { record.syncUpdatedAt = record.syncUpdatedAt || now; })
      ]);
    });
  }
}

export const db = new StudyNetDatabase();
