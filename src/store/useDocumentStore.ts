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
  getDocumentById: (id: string) => DocumentRecord | undefined;
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

  getDocumentById: (id) => {
    return get().documents.find(d => d.id === id);
  }
}));
