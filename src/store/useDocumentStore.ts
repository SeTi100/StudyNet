import { create } from 'zustand';
import { db, DocumentRecord } from '../db/schema';
import { extractPdfMetadata, enrichDocumentMetadata } from '../services/metadataExtractionService';

export interface ScanProgress {
  current: number;
  total: number;
  currentFileName: string;
}

interface DocumentState {
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  folderHandle: FileSystemDirectoryHandle | null;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
  loadDocuments: () => Promise<void>;
  openDocument: (id: string) => void;
  setFolderHandle: (handle: FileSystemDirectoryHandle) => void;
  scanFolder: () => Promise<void>;
  updateReadingProgress: (docId: string, page: number) => void;
  markPageRead: (docId: string, page: number) => Promise<void>;
  toggleCompleted: (docId: string) => Promise<void>;
  setBibliographyStartPage: (docId: string, page: number | null) => Promise<void>;
  getDocumentById: (id: string) => DocumentRecord | undefined;
}

export interface ReadingProgressInfo {
  percent: number;
  readPagesCount: number;
  effectiveTotalPages: number;
  isCompleted: boolean;
  hasBibliography: boolean;
}

export function calculateReadingProgress(doc: DocumentRecord): ReadingProgressInfo {
  if (!doc) {
    return { percent: 0, readPagesCount: 0, effectiveTotalPages: 1, isCompleted: false, hasBibliography: false };
  }

  const isCompleted = !!doc.isCompleted;
  const totalPages = Math.max(doc.totalPages || 1, 1);
  const hasBib = !!(doc.bibliographyStartPage && doc.bibliographyStartPage > 1 && doc.bibliographyStartPage <= totalPages);
  const effectiveTotalPages = hasBib ? Math.max(doc.bibliographyStartPage! - 1, 1) : totalPages;

  const readSet = new Set(doc.readPages || []);
  
  let readPagesCount = 0;
  for (const page of readSet) {
    if (page <= effectiveTotalPages) {
      readPagesCount++;
    }
  }

  let percent = Math.min(100, Math.round((readPagesCount / effectiveTotalPages) * 100)) || 0;
  if (isCompleted) {
    percent = 100;
  }

  return {
    percent,
    readPagesCount,
    effectiveTotalPages,
    isCompleted: isCompleted || percent === 100,
    hasBibliography: hasBib,
  };
}

const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  activeDocumentId: null,
  folderHandle: null,
  isScanning: false,
  scanProgress: null,

  loadDocuments: async () => {
    const docs = await db.documents.toArray();
    set({ documents: docs });
  },

  openDocument: (id) => {
    set({ activeDocumentId: id });
  },

  setFolderHandle: (handle) => {
    set({ folderHandle: handle });
  },

  scanFolder: async () => {
    const handle = get().folderHandle;
    if (!handle) return;

    set({
      isScanning: true,
      scanProgress: { current: 0, total: 0, currentFileName: 'Durchsuche Ordner nach PDFs...' },
    });

    try {
      // Helper to recursively find PDF files
      const findPdfs = async (dirHandle: FileSystemDirectoryHandle, path: string = ''): Promise<{name: string, handle: FileSystemFileHandle, path: string}[]> => {
        const pdfs: {name: string, handle: FileSystemFileHandle, path: string}[] = [];
        for await (const entry of (dirHandle as any).values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
            pdfs.push({ name: entry.name, handle: entry, path: path ? `${path}/${entry.name}` : entry.name });
          } else if (entry.kind === 'directory') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const subPdfs = await findPdfs(subDirHandle, path ? `${path}/${entry.name}` : entry.name);
            pdfs.push(...subPdfs);
          }
        }
        return pdfs;
      };

      const pdfFiles = await findPdfs(handle);
      const existingDocs = await db.documents.toArray();
      const existingPaths = new Set(existingDocs.map(d => d.folderRelativePath).filter(Boolean));

      const newPdfs = pdfFiles.filter(pdf => !existingPaths.has(pdf.path));
      const enrichDocs = existingDocs.filter(d => 
        (!d.authors || d.authors.length === 0 || d.authors[0] === 'Unknown Author' || d.totalPages <= 1) && 
        d.sourceType === 'folder'
      );

      const total = newPdfs.length + enrichDocs.length;
      let processed = 0;

      const newDocs: DocumentRecord[] = [];
      for (const pdf of newPdfs) {
        processed++;
        set({
          scanProgress: {
            current: processed,
            total,
            currentFileName: pdf.name,
          },
        });

        try {
          const file = await pdf.handle.getFile();
          const meta = await extractPdfMetadata(file, pdf.name);
          const doc: DocumentRecord = {
            id: crypto.randomUUID(),
            title: meta.title,
            authors: meta.authors,
            doi: meta.doi,
            publicationYear: meta.publicationYear,
            pdfOpfsPath: '', // Empty because it's in folder
            totalPages: meta.totalPages,
            addedAt: new Date(),
            lastReadPage: 1,
            lastReadAt: null,
            readingTimeSeconds: 0,
            sourceType: 'folder',
            folderRelativePath: pdf.path,
            readPages: [],
            isCompleted: false,
            bibliographyStartPage: null,
          };
          newDocs.push(doc);
        } catch (err) {
          console.warn('Metadata extraction failed during scan for', pdf.path, err);
          const fallbackDoc: DocumentRecord = {
            id: crypto.randomUUID(),
            title: pdf.name.replace('.pdf', ''),
            authors: ['Unknown Author'],
            pdfOpfsPath: '',
            totalPages: 1,
            addedAt: new Date(),
            lastReadPage: 1,
            lastReadAt: null,
            readingTimeSeconds: 0,
            sourceType: 'folder',
            folderRelativePath: pdf.path,
            readPages: [],
            isCompleted: false,
            bibliographyStartPage: null,
          };
          newDocs.push(fallbackDoc);
        }
      }

      if (newDocs.length > 0) {
        await db.documents.bulkAdd(newDocs);
        await get().loadDocuments();
      }

      // Also enrich existing folder documents that have missing authors or 1 page
      for (const existingDoc of enrichDocs) {
        processed++;
        set({
          scanProgress: {
            current: processed,
            total,
            currentFileName: existingDoc.title,
          },
        });

        try {
          await enrichDocumentMetadata(existingDoc, handle);
        } catch (e) {
          console.warn('Background enrichment failed for', existingDoc.title, e);
        }
      }

      await get().loadDocuments();
    } finally {
      set({ isScanning: false, scanProgress: null });
    }
  },

  updateReadingProgress: (docId, page) => {
    if (debounceTimers[docId]) {
      clearTimeout(debounceTimers[docId]);
    }
    
    debounceTimers[docId] = setTimeout(async () => {
      await db.documents.update(docId, {
        lastReadPage: page,
        lastReadAt: new Date()
      });
      // Update local state without full reload
      set((state) => ({
        documents: state.documents.map(d => d.id === docId ? { ...d, lastReadPage: page, lastReadAt: new Date() } : d)
      }));
    }, 500);
  },

  markPageRead: async (docId, page) => {
    const doc = get().documents.find(d => d.id === docId) || await db.documents.get(docId);
    if (!doc) return;

    const currentReadPages = new Set(doc.readPages || []);
    if (!currentReadPages.has(page)) {
      currentReadPages.add(page);
      const updatedReadPages = Array.from(currentReadPages).sort((a, b) => a - b);
      
      await db.documents.update(docId, {
        readPages: updatedReadPages,
        lastReadAt: new Date(),
      });

      set((state) => ({
        documents: state.documents.map(d => 
          d.id === docId 
            ? { ...d, readPages: updatedReadPages, lastReadAt: new Date() } 
            : d
        )
      }));
    }
  },

  toggleCompleted: async (docId) => {
    const doc = get().documents.find(d => d.id === docId) || await db.documents.get(docId);
    if (!doc) return;

    const newCompleted = !doc.isCompleted;
    await db.documents.update(docId, {
      isCompleted: newCompleted,
      lastReadAt: new Date(),
    });

    set((state) => ({
      documents: state.documents.map(d => 
        d.id === docId 
          ? { ...d, isCompleted: newCompleted, lastReadAt: new Date() } 
          : d
      )
    }));
  },

  setBibliographyStartPage: async (docId, page) => {
    await db.documents.update(docId, {
      bibliographyStartPage: page,
    });

    set((state) => ({
      documents: state.documents.map(d => 
        d.id === docId 
          ? { ...d, bibliographyStartPage: page } 
          : d
      )
    }));
  },

  getDocumentById: (id) => {
    return get().documents.find(d => d.id === id);
  }
}));
