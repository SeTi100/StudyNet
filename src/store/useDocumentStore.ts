import { create } from 'zustand';
import { db, DocumentRecord } from '../db/schema';

interface DocumentState {
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  folderHandle: FileSystemDirectoryHandle | null;
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

    const newDocs: DocumentRecord[] = [];
    for (const pdf of pdfFiles) {
      if (!existingPaths.has(pdf.path)) {
        const doc: DocumentRecord = {
          id: crypto.randomUUID(),
          title: pdf.name.replace('.pdf', ''),
          authors: [],
          pdfOpfsPath: '', // Empty because it's in folder
          totalPages: 1, // Will be updated when opened
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
      }
    }

    if (newDocs.length > 0) {
      await db.documents.bulkAdd(newDocs);
      get().loadDocuments();
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
