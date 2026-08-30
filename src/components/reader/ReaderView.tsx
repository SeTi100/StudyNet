import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { db, DocumentRecord } from '../../db/schema';
import { saveToOPFS, getFromOPFS, deleteFromOPFS, getPdfFromFolder } from '../../utils/opfsStorage';
import { useDocumentStore, calculateReadingProgress } from '../../store/useDocumentStore';
import { matchAndStoreCitations, extractDoiFromText } from '../../services/citationMatchingService';
import { VirtualizedPdfViewer, VirtualizedPdfViewerRef } from '../pdf/VirtualizedPdfViewer';
import { SearchBar } from '../search/SearchBar';
import { NotesEditor } from '../notes/NotesEditor';
import { CitationListView } from '../citations/CitationListView';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';
import {
  FileText,
  Upload,
  Trash2,
  BookOpen,
  PanelLeftClose,
  PanelLeft,
  Columns,
  Maximize2,
  Bookmark,
  Sparkles,
  Loader2,
  Calendar,
  Users,
  Scissors,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function ReaderView() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePdfDoc, setActivePdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [hitboxes, setHitboxes] = useState<Record<number, CitationHitbox[]>>({});
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [searchIndexJson, setSearchIndexJson] = useState<string | null>(null);
  const [bibliographyStartPage, setBibliographyStartPage] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'split' | 'pdf' | 'notes' | 'citations'>('split');
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [isSnipMode, setIsSnipMode] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const viewerRef = useRef<VirtualizedPdfViewerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Sync state to URL hash for Deep Linking
  const updateUrlHash = useCallback((docId: string | null, page: number | null) => {
    if (!docId) {
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    const params = new URLSearchParams();
    params.set('doc', docId);
    if (page && page > 1) {
      params.set('page', page.toString());
    }
    window.history.replaceState(null, '', `#${params.toString()}`);
  }, []);

  // Parse URL hash on initial mount or popstate
  const parseUrlHash = useCallback((): { docId?: string; page?: number } => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return {};
    const params = new URLSearchParams(hash);
    const docId = params.get('doc') || undefined;
    const pageStr = params.get('page');
    const page = pageStr ? parseInt(pageStr, 10) : undefined;
    return { docId, page };
  }, []);

  // Initialize Web Worker
  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../../workers/pdfProcessor.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = async (e: MessageEvent) => {
        const { type, payload } = e.data;
        if (type === 'PROCESS_PROGRESS') {
          setProcessProgress(`Processing page ${payload.current} / ${payload.total}...`);
        } else if (type === 'PROCESS_SUCCESS') {
          setHitboxes(payload.hitboxes);
          setPageTexts(payload.pageTexts);
          setSearchIndexJson(payload.searchIndexJson);
          setBibliographyStartPage(payload.bibliographyStartPage || null);
          if (payload.bibliographyStartPage) {
            useDocumentStore.getState().setBibliographyStartPage(payload.documentId, payload.bibliographyStartPage);
          }
          setIsProcessing(false);
          setProcessProgress('');

          try {
            sessionStorage.setItem(`hitboxes_${payload.documentId}`, JSON.stringify(payload.hitboxes));
            sessionStorage.setItem(`search_${payload.documentId}`, payload.searchIndexJson);
            sessionStorage.setItem(`texts_${payload.documentId}`, JSON.stringify(payload.pageTexts));
            if (payload.bibliographyStartPage) {
              sessionStorage.setItem(`bib_${payload.documentId}`, payload.bibliographyStartPage.toString());
            }
          } catch {
            // Storage quota warning
          }

          const allText = Object.values(payload.pageTexts as Record<number, string>).join('\n');
          const activeDoc = await db.documents.get(payload.documentId);
          await matchAndStoreCitations(
            payload.documentId,
            payload.extractedMarkers,
            allText,
            activeDoc?.title,
            activeDoc?.doi
          );
        } else if (type === 'PROCESS_ERROR') {
          console.error('Worker processing error:', payload.error);
          setIsProcessing(false);
          setProcessProgress('');
        }
      };

      return () => {
        worker.terminate();
      };
    } catch (err) {
      console.error('Worker initialization failed:', err);
    }
  }, []);

  // Select document and load PDF proxy
  const selectDocument = useCallback(async (doc: DocumentRecord, initialPage?: number) => {
    setActiveDocumentId(doc.id);
    setActivePdfDoc(null);
    setHitboxes({});
    setPageTexts({});
    setSearchIndexJson(null);
    setBibliographyStartPage(null);
    setIsProcessing(true);
    setProcessProgress('Loading PDF from OPFS...');

    if (initialPage) {
      setTargetPage(initialPage);
    }
    updateUrlHash(doc.id, initialPage || 1);

    try {
      let file: File;
      if (doc.sourceType === 'folder' && doc.folderRelativePath) {
        const folderHandle = useDocumentStore.getState().folderHandle;
        if (!folderHandle) {
          throw new Error('Bitte wähle den Quell-Ordner auf dem Dashboard erneut aus (Browser-Sicherheit).');
        }
        file = await getPdfFromFolder(folderHandle, doc.folderRelativePath);
      } else {
        file = await getFromOPFS(doc.pdfOpfsPath);
      }
      
      const arrayBuffer = await file.arrayBuffer();
      const loadedPdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      setActivePdfDoc(loadedPdf);

      // Update metadata on first open if it's a folder document that was never parsed
      if (doc.sourceType === 'folder' && doc.totalPages === 1 && doc.authors.length === 0) {
        try {
          const metadata = await loadedPdf.getMetadata();
          const info = metadata?.info as any;
          const authorStr = info?.Author || '';
          const authors = authorStr.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
          
          await db.documents.update(doc.id, {
            totalPages: loadedPdf.numPages,
            authors: authors,
            title: info?.Title || doc.title, // Keep filename if no title
          });
          
          // Refresh store
          useDocumentStore.getState().loadDocuments();
        } catch (e) {
          console.warn('Could not extract metadata', e);
        }
      }

      const cachedHitboxes = sessionStorage.getItem(`hitboxes_${doc.id}`);
      const cachedSearch = sessionStorage.getItem(`search_${doc.id}`);
      const cachedTexts = sessionStorage.getItem(`texts_${doc.id}`);
      const cachedBib = sessionStorage.getItem(`bib_${doc.id}`);

      if (cachedHitboxes && cachedSearch && cachedTexts) {
        setHitboxes(JSON.parse(cachedHitboxes));
        setSearchIndexJson(cachedSearch);
        setPageTexts(JSON.parse(cachedTexts));
        if (cachedBib) setBibliographyStartPage(parseInt(cachedBib, 10));
        setIsProcessing(false);
        setProcessProgress('');
      } else if (workerRef.current) {
        setProcessProgress('Analyzing text and citation hitboxes...');
        workerRef.current.postMessage({
          type: 'PROCESS_PDF',
          payload: {
            documentId: doc.id,
            pdfData: arrayBuffer,
          },
        });
      }
    } catch (err: any) {
      console.error('Error opening document:', err);
      showToast(err.message || 'Fehler beim Laden des PDFs');
      setIsProcessing(false);
      setProcessProgress('');
    }
  }, [updateUrlHash]);

  // Initial load of documents from Dexie and check Deep Link
  useEffect(() => {
    let isCurrent = true;
    db.documents.orderBy('addedAt').reverse().toArray().then((docs) => {
      if (!isCurrent) return;
      setDocuments(docs);

      const { docId, page } = parseUrlHash();
      if (docId) {
        const found = docs.find((d) => d.id === docId);
        if (found) {
          selectDocument(found, page);
          return;
        }
      }

      if (docs.length > 0) {
        selectDocument(docs[0]);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [parseUrlHash, selectDocument]); // removed activeDocumentId, documents, targetPage to prevent loops

  // Listen to hash changes separately
  useEffect(() => {
    const handleHashChange = () => {
      const { docId, page } = parseUrlHash();
      if (docId && docId !== activeDocumentId) {
        const found = documents.find((d) => d.id === docId);
        if (found) selectDocument(found, page);
      } else if (page && page !== targetPage) {
        setTargetPage(page);
        if (viewerRef.current) viewerRef.current.scrollToPage(page);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [activeDocumentId, documents, parseUrlHash, selectDocument, targetPage]);

  // Upload PDF Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessing(true);
      setProcessProgress('Saving PDF to OPFS storage...');

      const id = crypto.randomUUID();
      const fileName = `${id}.pdf`;
      const pdfOpfsPath = await saveToOPFS(file, 'pdfs', fileName);

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
      const totalPages = pdf.numPages;

      let title = file.name.replace(/\.pdf$/i, '');
      let authors = ['Unknown Author'];
      let doi: string | undefined = undefined;

      try {
        const metadata = await pdf.getMetadata();
        const info = metadata?.info as any;
        if (info?.Title && info.Title.trim().length > 3) {
          title = info.Title.trim();
        }
        if (info?.Author) {
          authors = [info.Author.trim()];
        }
      } catch {
        // metadata fallback
      }

      try {
        const page1 = await pdf.getPage(1);
        const textContent = await page1.getTextContent();
        const firstPageText = textContent.items.map((i: any) => i.str || '').join(' ');
        const extractedDoi = extractDoiFromText(firstPageText);
        if (extractedDoi) {
          doi = extractedDoi;
        }
      } catch {
        // ignore
      }

      const docRecord: DocumentRecord = {
        id,
        doi,
        title,
        authors,
        publicationYear: new Date().getFullYear(),
        pdfOpfsPath,
        totalPages,
        addedAt: new Date(),
        lastReadPage: 1,
        lastReadAt: null,
        readingTimeSeconds: 0,
        sourceType: 'opfs',
      };

      await db.documents.add(docRecord);
      const allDocs = await db.documents.orderBy('addedAt').reverse().toArray();
      setDocuments(allDocs);
      await selectDocument(docRecord);
      showToast(`Uploaded "${title}" to OPFS!`);
    } catch (err) {
      console.error('Failed to upload PDF:', err);
      alert('Failed to upload PDF to OPFS storage.');
      setIsProcessing(false);
      setProcessProgress('');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteDocument = async (e: React.MouseEvent, doc: DocumentRecord) => {
    e.stopPropagation();
    if (!confirm(`Delete "${doc.title}"?`)) return;

    try {
      await db.documents.delete(doc.id);
      await db.citations.where('documentId').equals(doc.id).delete();
      await deleteFromOPFS(doc.pdfOpfsPath);

      sessionStorage.removeItem(`hitboxes_${doc.id}`);
      sessionStorage.removeItem(`search_${doc.id}`);
      sessionStorage.removeItem(`texts_${doc.id}`);
      sessionStorage.removeItem(`bib_${doc.id}`);
      localStorage.removeItem(`notes_${doc.id}`);

      const remaining = documents.filter((d) => d.id !== doc.id);
      setDocuments(remaining);

      if (activeDocumentId === doc.id) {
        if (remaining.length > 0) {
          selectDocument(remaining[0]);
        } else {
          setActiveDocumentId(null);
          setActivePdfDoc(null);
          setHitboxes({});
          setPageTexts({});
          setSearchIndexJson(null);
          updateUrlHash(null, null);
        }
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  // Snip complete handler
  const handleSnipComplete = async (blob: Blob, pageNum: number) => {
    if (!activeDocumentId) return;
    try {
      const fileName = `${activeDocumentId}_snip_page${pageNum}_${Date.now()}.png`;
      const opfsPath = await saveToOPFS(blob, 'snips', fileName);

      // Append image markdown to note
      const currentNotes =
        localStorage.getItem(`notes_${activeDocumentId}`) ||
        `# Notes for ${activeDoc?.title || 'Document'}\n\n`;

      const snipMarkdown = `\n\n![Snippet Page ${pageNum}](${opfsPath})\n*Figure snippet from Page ${pageNum}*\n\n`;
      const updatedNotes = currentNotes + snipMarkdown;

      localStorage.setItem(`notes_${activeDocumentId}`, updatedNotes);
      setIsSnipMode(false);
      showToast(`Snip from page ${pageNum} saved to OPFS & added to Notes!`);
    } catch (err) {
      console.error('Failed to process snip:', err);
      alert('Failed to save snip.');
      setIsSnipMode(false);
    }
  };

  const [returnPageNum, setReturnPageNum] = useState<number | null>(null);

  // Deep link citation click handler
  const handleCitationClick = (marker: string, targetPage?: number, sourcePage?: number) => {
    if (marker === 'PDF Link' && targetPage) {
      if (sourcePage) setReturnPageNum(sourcePage);
      setTargetPage(targetPage);
      if (viewerRef.current) viewerRef.current.scrollToPage(targetPage);
      showToast(`Jumped to Page ${targetPage}`);
      return;
    }

    if (bibliographyStartPage) {
      const returnPage = sourcePage || targetPage;
      if (returnPage) {
        setReturnPageNum(returnPage);
      }
      setTargetPage(bibliographyStartPage);
      if (viewerRef.current) viewerRef.current.scrollToPage(bibliographyStartPage);
      showToast(`Jumped to Bibliography (Page ${bibliographyStartPage}) for ${marker}`);
    } else if (targetPage) {
      setTargetPage(targetPage);
      if (viewerRef.current) viewerRef.current.scrollToPage(targetPage);
    }
  };

  // Jump from CitationListView to PDF occurrence
  const handleJumpToCitationOccurrence = (marker: string) => {
    for (const [pageStr, pageHitboxList] of Object.entries(hitboxes)) {
      if (pageHitboxList.some((h) => h.marker === marker)) {
        const pageNum = parseInt(pageStr, 10);
        setReturnPageNum(targetPage || 1); // Allow returning to the list context if needed, though they are usually in citation tab.
        setTargetPage(pageNum);
        if (viewerRef.current) viewerRef.current.scrollToPage(pageNum);
        setActiveTab('split');
        showToast(`Jumped to ${marker} on Page ${pageNum}`);
        return;
      }
    }
    showToast(`Citation ${marker} not found on visible pages.`);
  };

  const storeDocs = useDocumentStore((state) => state.documents);
  const activeDoc = storeDocs.find((d) => d.id === activeDocumentId) || documents.find((d) => d.id === activeDocumentId);

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-blue-600 text-white text-xs px-3.5 py-2 rounded-lg shadow-2xl flex items-center gap-2 border border-blue-400/40 animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-72' : 'w-0'
        } flex flex-col bg-neutral-950 border-r border-neutral-800 transition-all duration-200 overflow-hidden flex-shrink-0 z-20`}
      >
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <a href="#dashboard" className="flex items-center gap-2.5 cursor-pointer hover:opacity-80 transition-opacity">
            <div className="p-2 bg-blue-600/20 border border-blue-500/40 rounded-lg text-blue-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-sm text-neutral-100 tracking-wide">StudyNet</h1>
              <p className="text-[11px] text-neutral-400">Back to Dashboard</p>
            </div>
          </a>
        </div>

        <div className="p-3 border-b border-neutral-800">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow flex items-center justify-center gap-2 transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Paper (PDF)</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider font-semibold text-neutral-500">
            Saved Documents ({documents.length})
          </div>

          {documents.length === 0 ? (
            <div className="text-center py-10 px-4 text-xs text-neutral-500 leading-relaxed">
              No papers loaded yet. Upload a PDF paper to extract hitboxes, citations, and search index.
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                onClick={() => selectDocument(doc)}
                className={`p-2.5 rounded-lg text-left cursor-pointer transition-all flex items-start gap-2.5 group relative ${
                  activeDocumentId === doc.id
                    ? 'bg-blue-950/50 border border-blue-600/60 text-white shadow-sm'
                    : 'hover:bg-neutral-900 border border-transparent text-neutral-300'
                }`}
              >
                <div className="mt-0.5 p-1.5 rounded bg-neutral-900 border border-neutral-800 text-blue-400 flex-shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 pr-6">
                  <div className="text-xs font-medium truncate group-hover:text-blue-300">
                    {doc.title}
                  </div>
                  <div className="text-[11px] text-neutral-500 mt-0.5 truncate">
                    {doc.authors?.join(', ')}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-1 flex items-center gap-2">
                    <span>{doc.totalPages} pages</span>
                    <span>&bull;</span>
                    <span>{new Date(doc.addedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <button
                  onClick={(e) => handleDeleteDocument(e, doc)}
                  className="absolute right-2 top-2.5 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  title="Delete Paper"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-neutral-950 relative">
        {/* Back to Text Floating Button */}
        {returnPageNum && (
          <button
            onClick={() => {
              setTargetPage(returnPageNum);
              if (viewerRef.current) viewerRef.current.scrollToPage(returnPageNum);
              setReturnPageNum(null);
              showToast(`Returned to Page ${returnPageNum}`);
            }}
            className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 text-sm font-semibold transition-all hover:scale-105 border border-blue-400/30"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Text (Page {returnPageNum})
          </button>
        )}

        {/* Top Navigation Bar */}
        <div className="h-14 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur px-4 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 rounded-md transition-colors"
              title="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>

            {activeDoc && (
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold text-neutral-200 truncate max-w-md">
                    {activeDoc.title}
                  </h2>
                  {activeDoc.doi && (
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">
                      DOI: {activeDoc.doi}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-neutral-400 truncate mt-0.5">
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3 text-neutral-500" />
                    {activeDoc.authors?.join(', ')}
                  </span>
                  {activeDoc.publicationYear && (
                    <>
                      <span>&bull;</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-neutral-500" />
                        {activeDoc.publicationYear}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Search Bar, Snip Tool & Tabs */}
          <div className="flex items-center gap-3">
            {activeDoc && (
              <SearchBar
                searchIndexJson={searchIndexJson}
                pageTexts={pageTexts}
                onSelectPage={(pageNum) => {
                  setTargetPage(pageNum);
                  updateUrlHash(activeDoc.id, pageNum);
                  if (viewerRef.current) {
                    viewerRef.current.scrollToPage(pageNum);
                  }
                }}
              />
            )}

            {/* Snip Tool Button */}
            {activeDoc && (
              <button
                onClick={() => {
                  setIsSnipMode(!isSnipMode);
                  if (!isSnipMode) {
                    showToast('Snip Mode Active: Drag a box on any PDF page to crop figure to OPFS');
                  }
                }}
                className={`px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 border transition-all ${
                  isSnipMode
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500 animate-pulse font-medium shadow-md'
                    : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:text-white hover:bg-neutral-800'
                }`}
                title="Snip Figure / Crop to OPFS Notes"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">{isSnipMode ? 'Snipping...' : 'Snip Tool'}</span>
              </button>
            )}

            {/* Reading Progress & Completion Toggle */}
            {activeDoc && (() => {
              const progress = calculateReadingProgress(activeDoc);
              return (
                <button
                  onClick={async () => {
                    await useDocumentStore.getState().toggleCompleted(activeDoc.id);
                    showToast(progress.isCompleted ? 'Als ungelesen markiert' : 'Als gelesen markiert (100%)');
                  }}
                  className={`px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 border transition-all ${
                    progress.isCompleted
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-medium'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                  title={
                    progress.isCompleted
                      ? 'Paper als gelesen markiert (Klick zum Zurücksetzen)'
                      : `Fortschritt: ${progress.readPagesCount}/${progress.effectiveTotalPages} Seiten (${progress.percent}%)${progress.hasBibliography ? ' – ohne Quellenverzeichnis' : ''}. Klick zum Fertig-Markieren`
                  }
                >
                  <CheckCircle2 className={`w-3.5 h-3.5 ${progress.isCompleted ? 'text-emerald-400' : 'text-neutral-500'}`} />
                  <span className="hidden sm:inline font-mono text-[11px]">
                    {progress.isCompleted ? 'Gelesen' : `${progress.percent}%`}
                  </span>
                </button>
              );
            })()}

            {/* View Mode Tabs (Desktop) */}
            <div className="hidden md:flex items-center bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
              <button
                onClick={() => setActiveTab('pdf')}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'pdf'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Nur PDF (Vollbild – Notizen ausgeblendet)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>
              <button
                onClick={() => setActiveTab('split')}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'split'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Geteilte Ansicht (PDF + Notizen)"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Split</span>
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'notes'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Nur Notizen (Vollbild)"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Notizen</span>
              </button>
              <button
                onClick={() => setActiveTab('citations')}
                className={`px-2.5 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'citations'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Zitate-Übersicht"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Zitate</span>
              </button>
            </div>
          </div>
        </div>

        {/* Processing Progress */}
        {isProcessing && (
          <div className="bg-blue-950/80 border-b border-blue-800/60 px-4 py-2 flex items-center justify-between text-xs text-blue-200 animate-pulse">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>{processProgress || 'Processing document in Web Worker...'}</span>
            </div>
            <span className="text-[11px] text-blue-300 font-mono">Hitbox & MiniSearch Extraction</span>
          </div>
        )}

        {/* Viewport Content */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {!activeDoc ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-500">
              <div className="p-4 bg-neutral-900 rounded-full border border-neutral-800 mb-4 text-blue-400">
                <FileText className="w-8 h-8" />
              </div>
              <h3 className="text-base font-semibold text-neutral-300 mb-1">No Document Selected</h3>
              <p className="text-xs max-w-sm leading-relaxed mb-4">
                Select a paper from the left sidebar or upload a scientific PDF to explore citations and full-text search.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow flex items-center gap-2 transition-colors min-h-[44px]"
              >
                <Upload className="w-4 h-4" />
                <span>Upload PDF Document</span>
              </button>
            </div>
          ) : (
            <>
              {/* PDF Viewer Pane */}
              <div
                className={`h-full min-w-0 ${
                  activeTab === 'pdf'
                    ? 'flex w-full'
                    : activeTab === 'split'
                    ? 'flex w-full md:w-3/5'
                    : 'hidden'
                }`}
              >
                {activePdfDoc ? (
                  <VirtualizedPdfViewer
                    ref={viewerRef}
                    documentId={activeDoc.id}
                    pdfDocument={activePdfDoc}
                    hitboxes={hitboxes}
                    targetPage={targetPage}
                    isSnipMode={isSnipMode}
                    onSnipComplete={handleSnipComplete}
                    onCitationClick={handleCitationClick}
                    onJumpToReferences={(marker, sourcePage) => handleCitationClick(marker, undefined, sourcePage)}
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs w-full p-4 text-center">
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mb-2" />
                        <p>Loading PDF Pages...</p>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-red-400 font-medium">
                          {activeDoc?.sourceType === 'folder' 
                            ? 'Browser-Sicherheit: Zugriff auf den Ordner fehlt.' 
                            : 'Fehler beim Laden des PDFs.'}
                        </p>
                        {activeDoc?.sourceType === 'folder' && (
                          <>
                            <p className="text-neutral-500 max-w-xs mb-2">Nach einem Neuladen der Seite muss die Berechtigung für lokale Dateien erneut erteilt werden.</p>
                            <button
                              onClick={async () => {
                                try {
                                  const handle = await (window as any).showDirectoryPicker();
                                  useDocumentStore.getState().setFolderHandle(handle);
                                  selectDocument(activeDoc, targetPage || 1);
                                } catch (e) {
                                  console.error(e);
                                }
                              }}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow transition-colors"
                            >
                              Ordner-Zugriff erteilen
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Notes Pane */}
              <div
                className={`h-full min-w-0 ${
                  activeTab === 'notes'
                    ? 'flex w-full'
                    : activeTab === 'split'
                    ? 'hidden md:flex md:w-2/5'
                    : 'hidden'
                }`}
              >
                <NotesEditor
                  documentId={activeDoc.id}
                  documentTitle={activeDoc.title}
                  onClose={() => setActiveTab('pdf')}
                />
              </div>

              {/* Citations Tab */}
              {activeTab === 'citations' && (
                <div className="h-full w-full min-w-0 flex">
                  <CitationListView
                    documentId={activeDoc.id}
                    onJumpToCitation={handleJumpToCitationOccurrence}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile Bottom Navigation */}
        {activeDoc && (
          <div className="md:hidden flex items-center justify-around bg-neutral-950 border-t border-neutral-800 p-2 shrink-0 pb-safe">
            <button 
              onClick={() => setActiveTab('pdf')} 
              className={`flex flex-col items-center gap-1 p-2 min-h-[44px] min-w-[44px] ${activeTab === 'pdf' || activeTab === 'split' ? 'text-blue-400' : 'text-neutral-500'}`}
            >
              <FileText className="w-5 h-5" />
              <span className="text-[10px] font-medium">PDF</span>
            </button>
            <button 
              onClick={() => setActiveTab('notes')} 
              className={`flex flex-col items-center gap-1 p-2 min-h-[44px] min-w-[44px] ${activeTab === 'notes' ? 'text-blue-400' : 'text-neutral-500'}`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="text-[10px] font-medium">Notizen</span>
            </button>
            <button 
              onClick={() => setActiveTab('citations')} 
              className={`flex flex-col items-center gap-1 p-2 min-h-[44px] min-w-[44px] ${activeTab === 'citations' ? 'text-blue-400' : 'text-neutral-500'}`}
            >
              <Bookmark className="w-5 h-5" />
              <span className="text-[10px] font-medium">Zitate</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
