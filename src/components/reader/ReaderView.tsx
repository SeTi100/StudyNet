import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { db, DocumentRecord } from '../../db/schema';
import { saveToOPFS, getFromOPFS, deleteFromOPFS, getPdfFromFolder } from '../../utils/opfsStorage';
import { useDocumentStore, calculateReadingProgress } from '../../store/useDocumentStore';
import { useViewerStore } from '../../store/useViewerStore';
import { extractPdfMetadata, enrichDocumentMetadata } from '../../services/metadataExtractionService';
import { matchAndStoreCitations, extractDoiFromText } from '../../services/citationMatchingService';
import { VirtualizedPdfViewer, VirtualizedPdfViewerRef } from '../pdf/VirtualizedPdfViewer';
import { SearchBar } from '../search/SearchBar';
import { NotesEditor } from '../notes/NotesEditor';
import { CitationListView } from '../citations/CitationListView';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';
import { SnipActionPopover } from '../pdf/SnipActionPopover';
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
  X,
  Droplet,
  Download,
  RefreshCw,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';

import { LiquidPdfViewer } from '../pdf/LiquidPdfViewer';
import { checkAndSyncFluidMode, triggerFluidGeneration, exportParsedJson, regenerateFluidMode } from '../../services/doclingService';
import { formatApaCitation } from '../../utils/citationFormatter';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function ReaderView() {
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(() => {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('doc') || useDocumentStore.getState().activeDocumentId || null;
  });
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [activePdfDoc, setActivePdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [hitboxes, setHitboxes] = useState<Record<number, CitationHitbox[]>>({});
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [searchIndexJson, setSearchIndexJson] = useState<string | null>(null);
  const [bibliographyStartPage, setBibliographyStartPage] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('studynet_reader_sidebar_open');
      if (saved !== null) {
        return saved === 'true';
      }
    } catch {}
    return true;
  });
  const [activeTab, setActiveTab] = useState<'split' | 'pdf' | 'notes' | 'citations'>('pdf');
  const [targetPage, setTargetPage] = useState<number | null>(null);
  const [initialPageRatio, setInitialPageRatio] = useState<number>(0);
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(1.414);
  const [isSnipMode, setIsSnipMode] = useState(false);
  const [pendingSnip, setPendingSnip] = useState<{
    blob: Blob;
    pageNumber: number;
    previewUrl: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [returnPageNum, setReturnPageNum] = useState<number | null>(null);
  const [copiedCitation, setCopiedCitation] = useState<boolean>(false);

  // Liquid Mode States
  const [viewMode, setViewMode] = useState<'original' | 'liquid'>('original');
  const [liquidMarkdown, setLiquidMarkdown] = useState<string | null>(null);
  const [fluidStatus, setFluidStatus] = useState<'none' | 'processing' | 'ready' | 'error'>('none');
  const [showFluidMenu, setShowFluidMenu] = useState<boolean>(false);
  const fluidMenuRef = useRef<HTMLDivElement>(null);

  // Close fluid dropdown menu on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (fluidMenuRef.current && !fluidMenuRef.current.contains(event.target as Node)) {
        setShowFluidMenu(false);
      }
    }
    if (showFluidMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showFluidMenu]);


  // Resizable Split Pane State (percentage width of Notes pane: 15% to 80%)
  const [splitWidthPercent, setSplitWidthPercent] = useState<number>(() => {
    const saved = localStorage.getItem('notes_split_width_percent');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed >= 15 && parsed <= 80) return parsed;
    }
    return 40;
  });
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);

  const viewerRef = useRef<VirtualizedPdfViewerRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const returnTimerRef = useRef<NodeJS.Timeout | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Mouse drag handler for resizing the split pane
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingSplit(true);
    const startX = e.clientX;
    const initialPercent = splitWidthPercent;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (totalWidth <= 0) return;

      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / totalWidth) * 100;
      // Dragging left (negative deltaX) increases right notes pane width
      const newNotesPercent = Math.min(80, Math.max(15, initialPercent - deltaPercent));
      setSplitWidthPercent(newNotesPercent);
    };

    const onMouseUp = () => {
      setIsResizingSplit(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSplitWidthPercent((current) => {
        localStorage.setItem('notes_split_width_percent', current.toFixed(1));
        return current;
      });
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Touch drag handler for tablet / touchscreens
  const handleSplitTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    setIsResizingSplit(true);
    const startX = e.touches[0].clientX;
    const initialPercent = splitWidthPercent;

    const onTouchMove = (moveEvent: TouchEvent) => {
      if (!splitContainerRef.current || moveEvent.touches.length !== 1) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const totalWidth = rect.width;
      if (totalWidth <= 0) return;

      const deltaX = moveEvent.touches[0].clientX - startX;
      const deltaPercent = (deltaX / totalWidth) * 100;
      const newNotesPercent = Math.min(80, Math.max(15, initialPercent - deltaPercent));
      setSplitWidthPercent(newNotesPercent);
    };

    const onTouchEnd = () => {
      setIsResizingSplit(false);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      setSplitWidthPercent((current) => {
        localStorage.setItem('notes_split_width_percent', current.toFixed(1));
        return current;
      });
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  };

  const updateReturnPage = useCallback((pageNum: number | null) => {
    if (returnTimerRef.current) {
      clearTimeout(returnTimerRef.current);
      returnTimerRef.current = null;
    }
    setReturnPageNum(pageNum);
    if (pageNum !== null) {
      returnTimerRef.current = setTimeout(() => {
        setReturnPageNum(null);
        returnTimerRef.current = null;
      }, 15000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (returnTimerRef.current) {
        clearTimeout(returnTimerRef.current);
      }
    };
  }, []);

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
    const currentHash = window.location.hash.replace(/^#/, '');
    const currentParams = new URLSearchParams(currentHash);

    const params = new URLSearchParams();
    params.set('doc', docId);
    if (page && page > 1) {
      params.set('page', page.toString());
    }
    if (currentParams.get('highlight')) {
      params.set('highlight', currentParams.get('highlight')!);
    }
    if (currentParams.get('from')) {
      params.set('from', currentParams.get('from')!);
    }
    window.history.replaceState(null, '', `#${params.toString()}`);
  }, []);

  const [isFromSearch, setIsFromSearch] = useState<boolean>(false);

  // Parse URL hash on initial mount or popstate
  const parseUrlHash = useCallback((): { docId?: string; page?: number; highlight?: string; from?: string } => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return {};
    const params = new URLSearchParams(hash);
    const docId = params.get('doc') || undefined;
    const pageStr = params.get('page');
    const page = pageStr ? parseInt(pageStr, 10) : undefined;
    const highlight = params.get('highlight') ? decodeURIComponent(params.get('highlight')!) : undefined;
    const from = params.get('from') || undefined;

    if (highlight && page) {
      const current = useViewerStore.getState().passageHighlight;
      if (!current || current.pageNumber !== page) {
        useViewerStore.getState().setPassageHighlight({ text: highlight, pageNumber: page });
      }
    }

    if (from === 'search' || highlight) {
      setIsFromSearch(true);
    }

    return { docId, page, highlight, from };
  }, []);

  // Liquid Mode Polling
  useEffect(() => {
    let interval: any;
    if (activeDocumentId && (fluidStatus === 'none' || fluidStatus === 'processing')) {
      interval = setInterval(async () => {
        const res = await checkAndSyncFluidMode(activeDocumentId);
        setFluidStatus(res.status as any);
        if (res.status === 'ready' && res.markdown) {
          setLiquidMarkdown(res.markdown);
          clearInterval(interval);
        }
      }, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeDocumentId, fluidStatus]);

  // Active reading time tracking: Updates lastReadAt ONLY if user is reading actively for >= 10s
  useEffect(() => {
    if (!activeDocumentId) return;

    let secondsInSession = 0;
    const interval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      secondsInSession += 2;

      // Only count as active reading if user spends at least 10 seconds in the reader
      if (secondsInSession >= 10 && secondsInSession % 10 === 0) {
        const now = Date.now();
        const nowDate = new Date();
        const doc = useDocumentStore.getState().documents.find((d) => d.id === activeDocumentId);
        const newTotal = (doc?.readingTimeSeconds || 0) + 10;

        useDocumentStore.setState((state) => ({
          documents: state.documents.map((d) =>
            d.id === activeDocumentId
              ? { ...d, readingTimeSeconds: newTotal, lastReadAt: nowDate, syncUpdatedAt: now }
              : d
          ),
        }));

        try {
          await db.documents.update(activeDocumentId, {
            readingTimeSeconds: newTotal,
            lastReadAt: nowDate,
            syncUpdatedAt: now,
          });
        } catch (err) {
          console.warn('Failed to update reading time:', err);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeDocumentId]);

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
    useDocumentStore.getState().openDocument(doc.id);
    setActivePdfDoc(null);
    setHitboxes({});
    setPageTexts({});
    setSearchIndexJson(null);
    setBibliographyStartPage(null);
    updateReturnPage(null);
    setIsProcessing(true);
    setProcessProgress('Loading PDF from OPFS...');

    // Liquid Mode initial state
    setViewMode('original');
    setLiquidMarkdown(null);
    setFluidStatus(doc.fluidStatus || 'none');
    
    // Quick initial check for fluid mode
    checkAndSyncFluidMode(doc.id).then(res => {
      setFluidStatus(res.status as any);
      if (res.status === 'ready' && res.markdown) {
        setLiquidMarkdown(res.markdown);
      }
    });

    // Letzten Lesestand aus Zustand Store oder Dexie abrufen
    const storeDoc = useDocumentStore.getState().documents.find((d) => d.id === doc.id);
    const latestDoc = storeDoc || (await db.documents.get(doc.id)) || doc;
    const resumePage = initialPage && initialPage >= 1 
      ? initialPage 
      : (latestDoc.lastReadPage && latestDoc.lastReadPage >= 1 ? latestDoc.lastReadPage : 1);
    const resumeRatio = (!initialPage && typeof latestDoc.lastReadPageRatio === 'number') ? latestDoc.lastReadPageRatio : 0;

    setTargetPage(resumePage);
    setInitialPageRatio(resumeRatio);
    updateUrlHash(doc.id, resumePage);

    try {
      let file: File | null = null;

      // 1. Zuerst OPFS versuchen (Funktioniert immer auf synchronisierten Mobilgeräten)
      if (doc.pdfOpfsPath) {
        try {
          file = await getFromOPFS(doc.pdfOpfsPath);
        } catch (e) {
          // Fallback auf Standard-Pfad
          try {
            file = await getFromOPFS(`opfs://pdfs/${doc.id}.pdf`);
          } catch (e2) {}
        }
      }

      // 2. Falls nicht im OPFS vorhanden, Quellordner versuchen (PC)
      if (!file && doc.sourceType === 'folder' && doc.folderRelativePath) {
        const folderHandle = useDocumentStore.getState().folderHandle;
        if (folderHandle) {
          try {
            file = await getPdfFromFolder(folderHandle, doc.folderRelativePath);
          } catch (e) {}
        }
      }

      // 3. Fallback: On-the-fly vom Sync-Server herunterladen!
      if (!file) {
        const { useSettingsStore } = await import('../../store/useSettingsStore');
        const syncUrl = useSettingsStore.getState().syncServerUrl;
        if (syncUrl) {
          setProcessProgress('PDF fehlt lokal. Versuche Download vom Server...');
          try {
            const fileRes = await fetch(`${syncUrl}/api/pdf/${doc.id}`);
            if (fileRes.ok) {
              const blob = await fileRes.blob();
              file = new File([blob], `${doc.id}.pdf`, { type: 'application/pdf' });
              
              // Direkt im OPFS cachen für die Zukunft
              const { saveToOPFS } = await import('../../utils/opfsStorage');
              const savedPath = await saveToOPFS(blob, 'pdfs', `${doc.id}.pdf`);
              doc.sourceType = 'opfs';
              doc.pdfOpfsPath = savedPath;
              await db.documents.put(doc);
            }
          } catch (e) {
            console.warn('On-the-fly download failed:', e);
          }
        }
      }

      if (!file) {
        throw new Error(doc.sourceType === 'folder' 
          ? 'PDF fehlt. Bitte öffne die App am PC, wähle den Quellordner neu aus ("Ordner Zugriff erteilen") und klicke auf Synchronisieren, damit die PDF hochgeladen wird.' 
          : 'PDF-Datei nicht gefunden. Bitte überprüfe deine Synchronisation.');
      }
      
      const arrayBuffer = await file.arrayBuffer();
      const loadedPdf = await pdfjsLib.getDocument({ 
        data: arrayBuffer.slice(0),
        verbosity: 0 // Suppress NameTree and non-fatal format warnings
      }).promise;

      // Extract exact aspect ratio from first page so virtualizer height is 100% accurate from frame 1
      let calculatedRatio = 1.414;
      try {
        const p1 = await loadedPdf.getPage(1);
        const vp = p1.getViewport({ scale: 1.0 });
        if (vp.width > 0 && vp.height > 0) {
          calculatedRatio = vp.height / vp.width;
        }
      } catch (e) {
        console.warn('Could not extract page 1 aspect ratio:', e);
      }
      setPageAspectRatio(calculatedRatio);
      setActivePdfDoc(loadedPdf);

      // Update metadata on first open if document lacks authors or proper totalPages
      const needsEnrichment = !doc.authors || doc.authors.length === 0 || doc.authors[0] === 'Unknown Author' || doc.totalPages <= 1;
      if (needsEnrichment) {
        try {
          const folderHandle = useDocumentStore.getState().folderHandle;
          await enrichDocumentMetadata(doc, folderHandle);
          useDocumentStore.getState().loadDocuments();
        } catch (e) {
          console.warn('Could not enrich metadata on select:', e);
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
  }, [updateUrlHash, updateReturnPage]);

  // Initial load of documents from Dexie and check Deep Link
  useEffect(() => {
    let isCurrent = true;
    useDocumentStore.getState().loadDocuments().then(async () => {
      if (!isCurrent) return;
      const allDocs = await db.documents.toArray();
      allDocs.sort((a, b) => {
        const tA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
        const tB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
        return tB - tA;
      });
      if (!isCurrent) return;
      setDocuments(allDocs);

      const { docId, page } = parseUrlHash();
      const targetId = docId || useDocumentStore.getState().activeDocumentId;
      if (targetId) {
        let found = allDocs.find((d) => d.id === targetId) 
                 || useDocumentStore.getState().documents.find((d) => d.id === targetId);
        if (!found) {
          found = await db.documents.get(targetId);
        }
        if (found) {
          selectDocument(found, page);
          return;
        }
      }

      if (allDocs.length > 0) {
        selectDocument(allDocs[0]);
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
        const found = documents.find((d) => d.id === docId) || useDocumentStore.getState().documents.find((d) => d.id === docId);
        if (found) {
          selectDocument(found, page);
        } else {
          db.documents.get(docId).then((d) => {
            if (d) selectDocument(d, page);
          });
        }
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
      const meta = await extractPdfMetadata(arrayBuffer, file.name);

      const docRecord: DocumentRecord = {
        id,
        doi: meta.doi,
        title: meta.title,
        authors: meta.authors,
        publicationYear: meta.publicationYear || new Date().getFullYear(),
        pdfOpfsPath,
        totalPages: meta.totalPages,
        addedAt: new Date(),
        lastReadPage: 1,
        lastReadAt: null,
        readingTimeSeconds: 0,
        sourceType: 'opfs',
        readPages: [],
        isCompleted: false,
        bibliographyStartPage: null,
      };

      await db.documents.add(docRecord);
      const allDocs = await db.documents.orderBy('addedAt').reverse().toArray();
      setDocuments(allDocs);
      await selectDocument(docRecord);
      showToast(`Uploaded "${meta.title}" to OPFS!`);
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

  // Snip complete handler (auto-copy to clipboard & show action popover)
  const handleSnipComplete = async (blob: Blob, pageNum: number) => {
    if (!activeDocumentId) return;

    // 1. Immediately copy to system clipboard
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
    } catch (err) {
      console.warn('Failed to auto-copy snip to clipboard:', err);
    }

    // 2. Revoke any previous previewUrl
    if (pendingSnip?.previewUrl) {
      URL.revokeObjectURL(pendingSnip.previewUrl);
    }

    const previewUrl = URL.createObjectURL(blob);
    setPendingSnip({
      blob,
      pageNumber: pageNum,
      previewUrl,
    });
    setIsSnipMode(false);
  };

  // Insert snip into Dexie Notes on user confirmation
  const handleInsertSnipToNotes = async (customMarkdown?: string) => {
    if (!activeDocumentId || !pendingSnip || !activeDoc) return;
    try {
      let insertedMarkdown = '';
      if (customMarkdown) {
        insertedMarkdown = `\n\n${customMarkdown}\n\n`;
      } else {
        const fileName = `${activeDocumentId}_snip_page${pendingSnip.pageNumber}_${Date.now()}.png`;
        const opfsPath = await saveToOPFS(pendingSnip.blob, 'snips', fileName);
        insertedMarkdown = `\n\n![Snippet Seite ${pendingSnip.pageNumber}](${opfsPath})\n*Abbildung aus Seite ${pendingSnip.pageNumber}*\n\n`;
      }

      // Append image markdown to Dexie note
      const existing = await db.notes.where('documentId').equals(activeDocumentId).first();

      if (existing) {
        await db.notes.update(existing.id, {
          content: existing.content + insertedMarkdown,
          updatedAt: new Date(),
        });
      } else {
        const defaultContent = `# Notes for ${activeDoc.title}\n\nKey insights and summary points from this study.\n\n### Important Findings\n- Point 1\n- Point 2\n\n### Visual Snippets\n`;
        await db.notes.add({
          id: crypto.randomUUID(),
          documentId: activeDocumentId,
          title: `Notes for ${activeDoc.title}`,
          content: defaultContent + insertedMarkdown,
          linkedAnnotationIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Switch to split view if currently only in PDF view
      if (activeTab === 'pdf') {
        setActiveTab('split');
      }

      if (pendingSnip.previewUrl) {
        URL.revokeObjectURL(pendingSnip.previewUrl);
      }
      setPendingSnip(null);
      showToast(`Snip von Seite ${pendingSnip.pageNumber} in Study Notes eingefügt!`);
    } catch (err) {
      console.error('Failed to insert snip to notes:', err);
      alert('Konnte Snip nicht in die Notizen einfügen.');
    }
  };

  const handleCloseSnipPopover = () => {
    if (pendingSnip?.previewUrl) {
      URL.revokeObjectURL(pendingSnip.previewUrl);
    }
    setPendingSnip(null);
  };

  // Deep link citation click handler
  const handleCitationClick = (marker: string, targetPage?: number, sourcePage?: number) => {
    if (marker === 'PDF Link' && targetPage) {
      if (sourcePage) updateReturnPage(sourcePage);
      setTargetPage(targetPage);
      if (viewerRef.current) viewerRef.current.scrollToPage(targetPage);
      showToast(`Jumped to Page ${targetPage}`);
      return;
    }

    if (bibliographyStartPage) {
      const returnPage = sourcePage || targetPage;
      if (returnPage) {
        updateReturnPage(returnPage);
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
        updateReturnPage(targetPage || 1); // Allow returning to the list context if needed, though they are usually in citation tab.
        setTargetPage(pageNum);
        if (viewerRef.current) viewerRef.current.scrollToPage(pageNum);
        setActiveTab('split');
        showToast(`Jumped to ${marker} on Page ${pageNum}`);
        return;
      }
    }
    showToast(`Citation ${marker} not found on visible pages.`);
  };

  // Track visible page changes and sync with URL
  const handleVisiblePageChange = useCallback((page: number) => {
    if (activeDocumentId) {
      updateUrlHash(activeDocumentId, page);
    }
  }, [activeDocumentId, updateUrlHash]);

  const storeDocs = useDocumentStore((state) => state.documents);
  const displayDocs = storeDocs.length > 0 ? storeDocs : documents;
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
            Saved Documents ({displayDocs.length})
          </div>

          {displayDocs.length === 0 ? (
            <div className="text-center py-10 px-4 text-xs text-neutral-500 leading-relaxed">
              No papers loaded yet. Upload a PDF paper to extract hitboxes, citations, and search index.
            </div>
          ) : (
            displayDocs.map((doc) => (
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
        {/* Floating Return Buttons (Back to Text / Back to Search) */}
        {(returnPageNum || isFromSearch) && (
          <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-4 duration-300">
            {returnPageNum && (
              <div className="flex items-center bg-blue-600 hover:bg-blue-500 rounded-full shadow-2xl transition-all hover:scale-105 border border-blue-400/30 overflow-hidden">
                <button
                  onClick={() => {
                    const target = returnPageNum;
                    updateReturnPage(null);
                    setTargetPage(target);
                    if (viewerRef.current) viewerRef.current.scrollToPage(target);
                    showToast(`Returned to Page ${target}`);
                  }}
                  className="text-white pl-4 pr-2.5 py-2.5 flex items-center gap-2 text-xs md:text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Text (Page {returnPageNum})
                </button>
                <button
                  onClick={() => updateReturnPage(null)}
                  className="text-blue-200 hover:text-white px-2.5 py-2.5 transition-colors border-l border-blue-400/30 flex items-center justify-center hover:bg-blue-400/20"
                  title="Ausblenden"
                  aria-label="Ausblenden"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {isFromSearch && (
              <button
                onClick={() => {
                  useViewerStore.getState().setPassageHighlight(null);
                  setIsFromSearch(false);
                  window.location.hash = '#dashboard';
                }}
                className="bg-neutral-900/95 hover:bg-neutral-800 text-neutral-100 px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 text-xs md:text-sm font-semibold transition-all hover:scale-105 border border-neutral-700 hover:border-blue-500/50 backdrop-blur-sm whitespace-nowrap"
              >
                <ArrowLeft className="w-4 h-4 text-blue-400" />
                <span>Zurück zur Suche</span>
              </button>
            )}
          </div>
        )}

        {/* Top Navigation Bar */}
        <div className="h-14 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur px-4 flex items-center justify-between gap-4 flex-shrink-0 w-full relative z-30">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => {
                useViewerStore.getState().setPassageHighlight(null);
                window.location.hash = '#dashboard';
              }}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 rounded-md transition-colors flex items-center gap-1.5 text-xs font-medium shrink-0"
              title="Zurück zum Dashboard / Suche"
            >
              <ArrowLeft className="w-4 h-4 text-blue-400" />
              <span className="hidden sm:inline">{isFromSearch ? 'Zur Suche' : 'Dashboard'}</span>
            </button>

            <button
              onClick={() => {
                setSidebarOpen((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem('studynet_reader_sidebar_open', String(next));
                  } catch {}
                  return next;
                });
              }}
              className="p-1.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 rounded-md transition-colors shrink-0"
              title="Toggle sidebar"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>

            {activeDoc && (
              <div className="min-w-0 flex-1 flex flex-col">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-xs font-semibold text-neutral-200 truncate min-w-0 flex-1" title={activeDoc.title}>
                    {activeDoc.title}
                  </h2>
                  {activeDoc.doi ? (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const citationText = formatApaCitation(activeDoc);
                          await navigator.clipboard.writeText(citationText);
                          setCopiedCitation(true);
                          showToast(`Zitation kopiert: "${citationText.slice(0, 50)}..."`);
                          setTimeout(() => setCopiedCitation(false), 2500);
                        } catch (err) {
                          console.warn('Clipboard write failed:', err);
                          prompt('Zitation zum Kopieren (Strg+C):', formatApaCitation(activeDoc));
                        }
                      }}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 flex items-center gap-1.5 transition-all cursor-pointer group/doi ${
                        copiedCitation
                          ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 ring-1 ring-emerald-500/30'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-blue-300 border-neutral-800 hover:border-blue-500/50'
                      }`}
                      title="Klicke hier, um die offizielle normierte Zitation (APA 7th + DOI) in die Zwischenablage zu kopieren"
                    >
                      {copiedCitation ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="font-semibold text-emerald-400">Zitation kopiert!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-neutral-500 group-hover/doi:text-blue-400 transition-colors" />
                          <span>DOI: {activeDoc.doi}</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const citationText = formatApaCitation(activeDoc);
                          await navigator.clipboard.writeText(citationText);
                          setCopiedCitation(true);
                          showToast(`Zitation kopiert: "${citationText.slice(0, 50)}..."`);
                          setTimeout(() => setCopiedCitation(false), 2500);
                        } catch (err) {
                          console.warn('Clipboard write failed:', err);
                          prompt('Zitation zum Kopieren (Strg+C):', formatApaCitation(activeDoc));
                        }
                      }}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 flex items-center gap-1.5 transition-all cursor-pointer group/doi ${
                        copiedCitation
                          ? 'bg-emerald-950/70 border-emerald-500/60 text-emerald-300 ring-1 ring-emerald-500/30'
                          : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-blue-300 border-neutral-800 hover:border-blue-500/50'
                      }`}
                      title="Klicke hier, um die normierte Zitation (APA 7th) in die Zwischenablage zu kopieren"
                    >
                      {copiedCitation ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="font-semibold text-emerald-400">Zitation kopiert!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-neutral-500 group-hover/doi:text-blue-400 transition-colors" />
                          <span>Zitation kopieren</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5 min-w-0">
                  <span className="flex items-center gap-1 min-w-0 truncate">
                    <Users className="w-3 h-3 text-neutral-500 shrink-0" />
                    <span className="truncate">{activeDoc.authors?.join(', ')}</span>
                  </span>
                  {activeDoc.publicationYear && (
                    <div className="flex items-center gap-2 shrink-0">
                      <span>&bull;</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-neutral-500" />
                        {activeDoc.publicationYear}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Search Bar, Snip Tool & Tabs */}
          <div className="flex items-center gap-3 flex-shrink-0">
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

            {/* Unified Liquid Mode Split Button with Hidden Dropdown */}
            {activeDoc && (
              <div className="relative flex items-center" ref={fluidMenuRef}>
                <button
                  onClick={async () => {
                    if (fluidStatus === 'ready' && liquidMarkdown) {
                      const pos = useDocumentStore.getState().getLatestReadingPosition(activeDoc.id);
                      const storeDoc = useDocumentStore.getState().documents.find(d => d.id === activeDoc.id);
                      const targetP = pos ? pos.page : (storeDoc?.lastReadPage || 1);
                      const targetR = pos ? pos.ratio : (storeDoc?.lastReadPageRatio || 0);
                      setTargetPage(targetP);
                      setInitialPageRatio(targetR);
                      setViewMode(viewMode === 'original' ? 'liquid' : 'original');
                    } else if (fluidStatus === 'processing') {
                      showToast('Liquid Mode wird im Hintergrund generiert... Bitte warten.');
                    } else {
                      showToast('Starte Liquid-Mode Generierung für dieses Paper...');
                      setFluidStatus('processing');
                      const res = await triggerFluidGeneration(activeDoc.id);
                      setFluidStatus(res.status as any);
                      if (res.status === 'none') {
                        showToast('Konnte Generierung nicht starten (Server nicht erreichbar).');
                      }
                    }
                  }}
                  className={`px-2.5 py-1.5 text-xs flex items-center gap-1.5 border transition-all ${
                    fluidStatus === 'ready' ? 'rounded-l-lg border-r-0' : 'rounded-lg'
                  } ${
                    viewMode === 'liquid'
                      ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-900/20'
                      : fluidStatus === 'processing'
                      ? 'bg-blue-950/40 text-blue-400 border-blue-800/60 cursor-wait'
                      : fluidStatus === 'ready'
                      ? 'bg-neutral-900 text-blue-400 border-blue-900/40 hover:bg-blue-950/40 hover:text-blue-300'
                      : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                  title={
                    fluidStatus === 'ready'
                      ? 'Liquid Mode umschalten (Fließtext E-Reader)'
                      : fluidStatus === 'processing'
                      ? 'Wird generiert... (kann 15-30s dauern)'
                      : 'Klicken, um Liquid Mode für dieses Paper zu generieren'
                  }
                >
                  <Droplet className={`w-3.5 h-3.5 ${fluidStatus === 'processing' ? 'animate-bounce text-blue-400' : ''}`} />
                  <span className="hidden lg:inline">
                    {viewMode === 'liquid'
                      ? 'Original PDF'
                      : fluidStatus === 'processing'
                      ? 'Generiere Fluid...'
                      : 'Fluid Mode'}
                  </span>
                </button>

                {/* Dropdown Toggle for Extra Options */}
                {fluidStatus === 'ready' && (
                  <button
                    onClick={() => setShowFluidMenu((prev) => !prev)}
                    className={`px-1.5 py-1.5 text-xs border rounded-r-lg flex items-center justify-center transition-colors ${
                      viewMode === 'liquid'
                        ? 'bg-blue-700 text-blue-100 border-blue-500 hover:bg-blue-800'
                        : 'bg-neutral-900 text-neutral-400 border-blue-900/40 hover:bg-neutral-800 hover:text-neutral-200'
                    }`}
                    title="Fluid Mode Optionen"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFluidMenu ? 'rotate-180' : ''}`} />
                  </button>
                )}

                {/* Hidden Dropdown Menu */}
                {showFluidMenu && fluidStatus === 'ready' && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-neutral-900/95 backdrop-blur-md border border-neutral-800 rounded-xl shadow-2xl z-50 py-1 text-xs animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
                    <button
                      onClick={async () => {
                        setShowFluidMenu(false);
                        const ok = await exportParsedJson(activeDoc.id, activeDoc.title);
                        if (ok) showToast('Docling Struktur-JSON exportiert!');
                        else showToast('JSON konnte nicht exportiert werden.');
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-neutral-800/80 flex items-center gap-2.5 text-neutral-300 hover:text-white transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <span>Docling JSON exportieren</span>
                    </button>

                    <div className="border-t border-neutral-800/80 my-1" />

                    <button
                      onClick={async () => {
                        setShowFluidMenu(false);
                        showToast('Lösche Cache & starte Fluid-Mode mit Docling...');
                        setFluidStatus('processing');
                        setLiquidMarkdown(null);
                        if (viewMode === 'liquid') {
                          setViewMode('original');
                        }
                        const res = await regenerateFluidMode(activeDoc.id);
                        if (res.status === 'processing') {
                          showToast('Neuverarbeitung (Docling) läuft im Hintergrund...');
                        } else {
                          showToast('Konnte Neuverarbeitung nicht starten.');
                          setFluidStatus('error');
                        }
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-neutral-800/80 flex items-center gap-2.5 text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span>Mit Docling neu verarbeiten</span>
                    </button>
                  </div>
                )}
              </div>
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
                className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'pdf'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Nur PDF (Vollbild – Notizen ausgeblendet)"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">PDF</span>
              </button>
              <button
                onClick={() => setActiveTab('split')}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'split'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Geteilte Ansicht (PDF + Notizen)"
              >
                <Columns className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Split</span>
              </button>
              <button
                onClick={() => setActiveTab('notes')}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'notes'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Nur Notizen (Vollbild)"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Notizen</span>
              </button>
              <button
                onClick={() => setActiveTab('citations')}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${
                  activeTab === 'citations'
                    ? 'bg-neutral-800 text-white font-medium shadow'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
                title="Zitate-Übersicht"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Zitate</span>
              </button>
            </div>
          </div>
        </div>

        {/* Snip Action Popover (right below the Snip Tool button) */}
        {pendingSnip && activeDoc && (
          <SnipActionPopover
            previewUrl={pendingSnip.previewUrl}
            blob={pendingSnip.blob}
            pageNumber={pendingSnip.pageNumber}
            documentTitle={activeDoc.title}
            onInsertToNotes={handleInsertSnipToNotes}
            onClose={handleCloseSnipPopover}
          />
        )}

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
        <div ref={splitContainerRef} className="flex-1 min-h-0 flex overflow-hidden relative">
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
                style={
                  activeTab === 'split'
                    ? { width: `${100 - splitWidthPercent}%` }
                    : undefined
                }
                className={`h-full min-w-0 ${
                  activeTab === 'pdf'
                    ? 'flex w-full'
                    : activeTab === 'split'
                    ? 'flex w-full md:flex'
                    : 'hidden'
                }`}
              >
                {activePdfDoc ? (
                  viewMode === 'liquid' && liquidMarkdown ? (
                    <LiquidPdfViewer
                      documentId={activeDoc.id}
                      markdown={liquidMarkdown}
                      totalPages={activeDoc.totalPages || 1}
                      initialPage={targetPage || activeDoc.lastReadPage || 1}
                      initialPageRatio={initialPageRatio ?? activeDoc.lastReadPageRatio ?? 0}
                      onPositionChange={(page, ratio) => {
                        updateUrlHash(activeDoc.id, page);
                      }}
                    />
                  ) : (
                    <VirtualizedPdfViewer
                      key={activeDoc.id}
                      ref={viewerRef}
                      documentId={activeDoc.id}
                      pdfDocument={activePdfDoc}
                      hitboxes={hitboxes}
                      pageAspectRatio={pageAspectRatio}
                      targetPage={targetPage}
                      initialPageRatio={initialPageRatio}
                      isSnipMode={isSnipMode}
                      onSnipComplete={handleSnipComplete}
                      onCitationClick={handleCitationClick}
                      onJumpToReferences={(marker, sourcePage) => handleCitationClick(marker, undefined, sourcePage)}
                      onVisiblePageChange={handleVisiblePageChange}
                    />
                  )
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 text-xs w-full p-4 text-center">
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mb-2" />
                        <p>Loading PDF Pages...</p>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <p className="text-red-400 font-medium text-lg">
                          PDF konnte nicht geladen werden
                        </p>
                        <p className="text-neutral-400 max-w-sm text-center">
                          Falls das Paper am PC per Ordner importiert wurde, stelle sicher, dass du am PC einmalig den Ordner-Zugriff auf dem Dashboard erteilst und danach auf "Jetzt synchronisieren" klickst.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Draggable Divider Handle (Desktop Split View) */}
              {activeTab === 'split' && (
                <div
                  onMouseDown={handleSplitMouseDown}
                  onTouchStart={handleSplitTouchStart}
                  onDoubleClick={() => {
                    setSplitWidthPercent(40);
                    localStorage.setItem('notes_split_width_percent', '40');
                  }}
                  className={`hidden md:flex w-1.5 bg-neutral-900 border-l border-neutral-800 hover:bg-blue-600/40 active:bg-blue-600 cursor-col-resize items-center justify-center relative select-none group z-10 shrink-0 transition-colors ${
                    isResizingSplit ? 'bg-blue-600/50' : ''
                  }`}
                  title="Ziehen zum Vergrößern / Verkleinern (Doppelklick für 40% Standard)"
                >
                  {/* Hit area extends ONLY to the right into notes, NEVER left over the PDF scrollbar */}
                  <div className="absolute inset-y-0 left-0 -right-2.5 cursor-col-resize z-10" />

                  {/* Visual Drag Handle Indicator */}
                  <div
                    className={`w-0.5 h-7 rounded-full transition-all duration-150 pointer-events-none z-20 ${
                      isResizingSplit
                        ? 'bg-blue-400 scale-y-125'
                        : 'bg-neutral-600 group-hover:bg-blue-400 group-hover:scale-y-125'
                    }`}
                  />
                </div>
              )}

              {/* Notes Pane */}
              <div
                style={
                  activeTab === 'split'
                    ? { width: `${splitWidthPercent}%` }
                    : undefined
                }
                className={`h-full min-w-0 ${
                  activeTab === 'notes'
                    ? 'flex w-full'
                    : activeTab === 'split'
                    ? 'hidden md:flex'
                    : 'hidden'
                }`}
              >
                <NotesEditor
                  key={activeDoc.id}
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
