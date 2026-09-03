import { create } from 'zustand';
import { db, DocumentRecord } from '../db/schema';
import { extractPdfMetadata, enrichDocumentMetadata } from '../services/metadataExtractionService';
import { findDuplicateDocument } from '../utils/documentDeduplication';

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
  updateReadingProgress: (docId: string, page: number, pageRatio?: number) => void;
  getLatestReadingPosition: (docId: string) => { page: number; ratio: number } | undefined;
  markPageRead: (docId: string, page: number) => Promise<void>;
  toggleCompleted: (docId: string) => Promise<void>;
  setBibliographyStartPage: (docId: string, page: number | null) => Promise<void>;
  reorderDocuments: (orderedDocIds: string[]) => Promise<void>;
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
const latestReadingPositions: Record<string, { page: number; ratio: number }> = {};

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
      const allKnownDocs = [...existingDocs];

      // Schnelle Index-Maps für O(1) Lookups
      const existingByPath = new Map<string, DocumentRecord>();
      for (const doc of existingDocs) {
        if (doc.folderRelativePath) {
          existingByPath.set(doc.folderRelativePath.toLowerCase(), doc);
        }
      }

      const enrichDocs = existingDocs.filter(d => 
        (!d.authors || d.authors.length === 0 || d.authors[0] === 'Unknown Author' || d.totalPages <= 1) && 
        d.sourceType === 'folder'
      );

      const total = pdfFiles.length + enrichDocs.length;
      let processed = 0;

      const newDocs: DocumentRecord[] = [];
      for (const pdf of pdfFiles) {
        processed++;

        try {
          const pathKey = pdf.path.toLowerCase();
          const existingByPathMatch = existingByPath.get(pathKey);

          // ── 1. SCHNELLER FAST-PATH CHECK VOR PDF-EXTRAKTION ──
          if (existingByPathMatch) {
            const file = await pdf.handle.getFile();
            const hasValidMetadata = !!(
              existingByPathMatch.title &&
              existingByPathMatch.title.length > 0 &&
              existingByPathMatch.totalPages >= 1
            );

            const isUnchanged =
              existingByPathMatch.fileLastModified === file.lastModified &&
              existingByPathMatch.fileSize === file.size;

            if (isUnchanged && hasValidMetadata) {
              // Datei und Metadaten sind unverändert -> Komplett überspringen (kein PDF-Parsing nötig)
              continue;
            }

            // Falls Metadaten schon da sind, aber Cache-Werte (fileLastModified / fileSize) fehlen:
            if ((!existingByPathMatch.fileLastModified || !existingByPathMatch.fileSize) && hasValidMetadata) {
              existingByPathMatch.fileLastModified = file.lastModified;
              existingByPathMatch.fileSize = file.size;
              await db.documents.update(existingByPathMatch.id, {
                fileLastModified: file.lastModified,
                fileSize: file.size,
              });
              continue;
            }
          }

          // Schneller Duplikat-Check nach Dateiname/Titel vor schwerem Parsing
          const quickTitle = pdf.name.replace(/\.pdf$/i, '');
          const quickDuplicate = findDuplicateDocument(
            { title: quickTitle, folderRelativePath: pdf.path },
            allKnownDocs
          );

          if (quickDuplicate && quickDuplicate.totalPages >= 1 && quickDuplicate.title && quickDuplicate.title !== 'Unknown Title') {
            const file = await pdf.handle.getFile();
            let updated = false;
            if (!quickDuplicate.folderRelativePath) {
              quickDuplicate.folderRelativePath = pdf.path;
              updated = true;
            }
            if (!quickDuplicate.fileLastModified || quickDuplicate.fileLastModified !== file.lastModified) {
              quickDuplicate.fileLastModified = file.lastModified;
              quickDuplicate.fileSize = file.size;
              updated = true;
            }
            if (updated) {
              quickDuplicate.syncUpdatedAt = Date.now();
              await db.documents.put(quickDuplicate);
              existingByPath.set(pathKey, quickDuplicate);
            }
            continue;
          }

          // ── 2. NUR FÜR NEUE ODER VERÄNDERTE DATEIEN PARSEN ──
          set({
            scanProgress: {
              current: processed,
              total,
              currentFileName: pdf.name,
            },
          });

          const file = await pdf.handle.getFile();
          const meta = await extractPdfMetadata(file, pdf.name);

          // ── DEDUPLIZIERUNG: Prüfe auf existierendes Dokument (per DOI, Pfad oder Titel) ──
          const existingMatch = findDuplicateDocument(
            { doi: meta.doi, title: meta.title, folderRelativePath: pdf.path },
            allKnownDocs
          );

          if (existingMatch) {
            console.log(`[Import Deduplizierung] "${meta.title}" existiert bereits (ID: ${existingMatch.id}). Aktualisiere Verknüpfung.`);
            let updated = false;

            // Pfad aktualisieren, falls noch nicht hinterlegt
            if (!existingMatch.folderRelativePath) {
              existingMatch.folderRelativePath = pdf.path;
              updated = true;
            }
            // Metadaten anreichern, falls beim alten Dokument fehlend
            if ((!existingMatch.doi || existingMatch.doi.length === 0) && meta.doi) {
              existingMatch.doi = meta.doi;
              updated = true;
            }
            if ((!existingMatch.authors || existingMatch.authors.length === 0 || existingMatch.authors[0] === 'Unknown Author') && meta.authors?.length > 0) {
              existingMatch.authors = meta.authors;
              updated = true;
            }
            if (meta.totalPages > 1 && (!existingMatch.totalPages || existingMatch.totalPages <= 1)) {
              existingMatch.totalPages = meta.totalPages;
              updated = true;
            }
            if (existingMatch.fileLastModified !== file.lastModified || existingMatch.fileSize !== file.size) {
              existingMatch.fileLastModified = file.lastModified;
              existingMatch.fileSize = file.size;
              updated = true;
            }

            if (updated) {
              existingMatch.syncUpdatedAt = Date.now();
              await db.documents.put(existingMatch);
              existingByPath.set(pathKey, existingMatch);
            }
            // Überspringe Erstellung eines doppelten Datensatzes
            continue;
          }

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
            fileLastModified: file.lastModified,
            fileSize: file.size,
            readPages: [],
            isCompleted: false,
            bibliographyStartPage: null,
            syncUpdatedAt: Date.now(),
          };
          newDocs.push(doc);
          allKnownDocs.push(doc);
          existingByPath.set(pathKey, doc);
        } catch (err) {
          console.warn('Metadata extraction failed during scan for', pdf.path, err);
          
          const fallbackTitle = pdf.name.replace(/\.pdf$/i, '');
          const existingMatch = findDuplicateDocument(
            { title: fallbackTitle, folderRelativePath: pdf.path },
            allKnownDocs
          );

          if (existingMatch) {
            continue;
          }

          let fileStats: { lastModified?: number; size?: number } = {};
          try {
            const f = await pdf.handle.getFile();
            fileStats = { lastModified: f.lastModified, size: f.size };
          } catch {}

          const fallbackDoc: DocumentRecord = {
            id: crypto.randomUUID(),
            title: fallbackTitle,
            authors: ['Unknown Author'],
            pdfOpfsPath: '',
            totalPages: 1,
            addedAt: new Date(),
            lastReadPage: 1,
            lastReadAt: null,
            readingTimeSeconds: 0,
            sourceType: 'folder',
            folderRelativePath: pdf.path,
            fileLastModified: fileStats.lastModified,
            fileSize: fileStats.size,
            readPages: [],
            isCompleted: false,
            bibliographyStartPage: null,
            syncUpdatedAt: Date.now(),
          };
          newDocs.push(fallbackDoc);
          allKnownDocs.push(fallbackDoc);
          existingByPath.set(pdf.path.toLowerCase(), fallbackDoc);
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

  getLatestReadingPosition: (docId) => {
    return latestReadingPositions[docId];
  },

  updateReadingProgress: (docId, page, pageRatio) => {
    const now = Date.now();
    const nowDate = new Date();
    const ratio = typeof pageRatio === 'number' ? Math.min(1, Math.max(0, pageRatio)) : 0;

    // 1. Immediately store in fast memory cache for instant mode-switching
    latestReadingPositions[docId] = { page, ratio };

    if (debounceTimers[docId]) {
      clearTimeout(debounceTimers[docId]);
    }
    
    // 2. Debounce React store update and Dexie write so active scrolling never triggers laggy React re-renders
    debounceTimers[docId] = setTimeout(async () => {
      set((state) => ({
        documents: state.documents.map((d) =>
          d.id === docId
            ? { ...d, lastReadPage: page, lastReadPageRatio: ratio, syncUpdatedAt: now }
            : d
        ),
      }));

      try {
        await db.documents.update(docId, {
          lastReadPage: page,
          lastReadPageRatio: ratio,
          syncUpdatedAt: now,
        });
      } catch (err) {
        console.warn('Failed to update reading progress in db:', err);
      }
    }, 200);
  },

  markPageRead: async (docId, page) => {
    const doc = get().documents.find(d => d.id === docId) || await db.documents.get(docId);
    if (!doc) return;

    const currentReadPages = new Set(doc.readPages || []);
    if (!currentReadPages.has(page)) {
      currentReadPages.add(page);
      const updatedReadPages = Array.from(currentReadPages).sort((a, b) => a - b);
      const now = Date.now();
      const nowDate = new Date();
      
      await db.documents.update(docId, {
        readPages: updatedReadPages,
        lastReadAt: nowDate,
        syncUpdatedAt: now,
      });

      set((state) => ({
        documents: state.documents.map(d => 
          d.id === docId 
            ? { ...d, readPages: updatedReadPages, lastReadAt: nowDate, syncUpdatedAt: now } 
            : d
        )
      }));
    }
  },

  toggleCompleted: async (docId) => {
    const doc = get().documents.find(d => d.id === docId) || await db.documents.get(docId);
    if (!doc) return;

    const newCompleted = !doc.isCompleted;
    const now = Date.now();
    const nowDate = new Date();

    await db.documents.update(docId, {
      isCompleted: newCompleted,
      lastReadAt: nowDate,
      syncUpdatedAt: now,
    });

    set((state) => ({
      documents: state.documents.map(d => 
        d.id === docId 
          ? { ...d, isCompleted: newCompleted, lastReadAt: nowDate, syncUpdatedAt: now } 
          : d
      )
    }));
  },

  setBibliographyStartPage: async (docId, page) => {
    const now = Date.now();
    await db.documents.update(docId, {
      bibliographyStartPage: page,
      syncUpdatedAt: now,
    });

    set((state) => ({
      documents: state.documents.map(d => 
        d.id === docId 
          ? { ...d, bibliographyStartPage: page, syncUpdatedAt: now } 
          : d
      )
    }));
  },

  reorderDocuments: async (orderedDocIds: string[]) => {
    const now = Date.now();
    const docMap = new Map<string, DocumentRecord>(get().documents.map(d => [d.id, { ...d }]));
    const updatedDocs: DocumentRecord[] = [];

    orderedDocIds.forEach((id, index) => {
      const doc = docMap.get(id);
      if (doc) {
        doc.customOrder = index;
        doc.syncUpdatedAt = now;
        updatedDocs.push(doc);
      }
    });

    // Handle any remaining documents not explicitly in orderedDocIds
    get().documents.forEach((doc) => {
      if (!orderedDocIds.includes(doc.id)) {
        updatedDocs.push(doc);
      }
    });

    set({ documents: updatedDocs });

    try {
      await db.transaction('rw', db.documents, async () => {
        for (let i = 0; i < orderedDocIds.length; i++) {
          await db.documents.update(orderedDocIds[i], {
            customOrder: i,
            syncUpdatedAt: now,
          });
        }
      });
    } catch (err) {
      console.error('Failed to persist reordered documents:', err);
    }
  },

  getDocumentById: (id) => {
    return get().documents.find(d => d.id === id);
  }
}));
