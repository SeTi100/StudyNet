import React, { useEffect, useState, useCallback } from 'react';
import { useDocumentStore } from '../../store/useDocumentStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { openSourceFolder } from '../../utils/opfsStorage';
import { PaperCard } from './PaperCard';
import { RecentNotes } from './RecentNotes';
import { AnnotationFeed } from './AnnotationFeed';
import { SemanticSearchBar } from '../search/SemanticSearchBar';
import { SearchResultsView } from '../search/SearchResultsView';
import { SettingsPanel } from '../settings/SettingsPanel';
import { FolderOpen, Plus, Search, Filter, Trash2, Settings } from 'lucide-react';
import { db, DocumentRecord } from '../../db/schema';
import { useSemanticSearchStore } from '../../store/useSemanticSearchStore';

/** Status der KI-Analyse pro Dokument */
type AnalysisStatus = 'none' | 'analyzing' | 'done';

export function Dashboard() {
  const { documents, loadDocuments, setFolderHandle, scanFolder } = useDocumentStore();
  const hasApiKey = useSettingsStore((s) => s.hasApiKey);
  const [filter, setFilter] = useState<'all' | 'recent' | 'tags'>('all');
  const [counts, setCounts] = useState<Record<string, { notes: number; annos: number }>>({});
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [analysisStatuses, setAnalysisStatuses] = useState<Record<string, AnalysisStatus>>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleClearDatabase = async () => {
    if (window.confirm('Bist du sicher? Alle lokal gespeicherten Papers und Notizen werden aus der Datenbank gelöscht (Die Original-PDFs auf deinem PC bleiben erhalten).')) {
      await db.documents.clear();
      await db.annotations.clear();
      await db.notes.clear();
      await db.citations.clear();
      await db.paperQuestions.clear();
      loadDocuments();
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Lade Annotations-/Notizen-Zähler UND Fragen-Zähler
  useEffect(() => {
    async function loadCounts() {
      const newCounts: Record<string, { notes: number; annos: number }> = {};
      const newQuestionCounts: Record<string, number> = {};
      const newStatuses: Record<string, AnalysisStatus> = {};

      for (const doc of documents) {
        const notes = await db.notes.where('documentId').equals(doc.id).count();
        const annos = await db.annotations.where('documentId').equals(doc.id).count();
        const questions = await db.paperQuestions.where('documentId').equals(doc.id).count();

        newCounts[doc.id] = { notes, annos };
        newQuestionCounts[doc.id] = questions;
        newStatuses[doc.id] = questions > 0 ? 'done' : 'none';
      }

      setCounts(newCounts);
      setQuestionCounts(newQuestionCounts);
      setAnalysisStatuses(newStatuses);
    }
    if (documents.length > 0) {
      loadCounts();
    }
  }, [documents]);

  const handleSelectFolder = async () => {
    try {
      const handle = await openSourceFolder();
      setFolderHandle(handle);
      await scanFolder();
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  const handleDocumentClick = (id: string) => {
    window.location.hash = `#doc=${id}`;
  };

  /**
   * Startet die KI-Analyse (Fragengenerierung) für ein einzelnes Paper.
   * Benötigt den pdfProcessor-Worker, um pageTexts zu extrahieren.
   */
  const handleAnalyzePaper = useCallback(async (documentId: string) => {
    if (!hasApiKey()) {
      setIsSettingsOpen(true);
      return;
    }

    // Status auf "analysierend" setzen
    setAnalysisStatuses((prev) => ({ ...prev, [documentId]: 'analyzing' }));

    try {
      // Lazy-Import um das Bundle klein zu halten
      const { generateQuestionsForDocument } = await import(
        '../../services/questionGenerationService'
      );

      // PDF-Dokument laden und Text extrahieren
      const doc = documents.find((d) => d.id === documentId);
      if (!doc) throw new Error('Dokument nicht gefunden');

      // pageTexts aus dem pdfProcessor-Worker holen
      // Wir müssen das PDF erneut verarbeiten – nutze bestehenden Worker
      const { getPdfFromFolder } = await import('../../utils/opfsStorage');
      const { getFromOPFS } = await import('../../utils/opfsStorage');
      const folderHandle = useDocumentStore.getState().folderHandle;

      let pdfData: ArrayBuffer;
      if (doc.sourceType === 'folder' && doc.folderRelativePath && folderHandle) {
        const file = await getPdfFromFolder(folderHandle, doc.folderRelativePath);
        pdfData = await file.arrayBuffer();
      } else if (doc.pdfOpfsPath) {
        const file = await getFromOPFS(doc.pdfOpfsPath);
        pdfData = await file.arrayBuffer();
      } else {
        throw new Error('PDF-Quelle nicht verfügbar');
      }

      // Text via pdfjs extrahieren
      const pdfjsLib = await import('pdfjs-dist');
      const pdfWorkerUrl = await import('pdfjs-dist/build/pdf.worker.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl.default;
      
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      const pageTexts: Record<number, string> = {};

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        pageTexts[i] = textContent.items
          .filter((item: any) => 'str' in item)
          .map((item: any) => item.str)
          .join(' ');
      }

      // Embedding Worker aus dem SearchStore holen
      const searchStore = useSemanticSearchStore.getState();
      if (!searchStore.isEmbeddingReady) {
        // Falls noch nicht geladen, initialisieren
        await searchStore.initializeSearch();
      }
      
      const embeddingWorker = useSemanticSearchStore.getState().embeddingWorker;
      if (!embeddingWorker) throw new Error('Embedding Worker nicht verfügbar');

      // Fragen generieren
      const results = await generateQuestionsForDocument(
        documentId,
        pageTexts,
        embeddingWorker,
        (progress) => {
          console.log(`[Analyse ${documentId}]`, progress.phase, progress);
        }
      );

      // Status aktualisieren
      setQuestionCounts((prev) => ({ ...prev, [documentId]: results.length }));
      setAnalysisStatuses((prev) => ({ ...prev, [documentId]: 'done' }));

      // Suchindex aktualisieren (damit neue Fragen direkt suchbar sind)
      // Wir setzen isInitialized kurz auf false, damit der Progress-Bar falls nötig gezeigt wird
      useSemanticSearchStore.setState({ isInitialized: false });
      await useSemanticSearchStore.getState().initializeSearch();

    } catch (err) {
      console.error('Analyse fehlgeschlagen:', err);
      setAnalysisStatuses((prev) => ({ ...prev, [documentId]: 'none' }));
      alert(`Analyse fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    }
  }, [documents, hasApiKey]);

  let displayedDocs = [...documents];
  if (filter === 'recent') {
    displayedDocs.sort((a, b) => {
      const timeA = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0;
      const timeB = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0;
      return timeB - timeA;
    });
  }

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden flex-col md:flex-row select-none">
      
      {/* Sidebar Desktop / Topbar Mobile */}
      <div className="w-full md:w-64 border-b md:border-r border-neutral-800 bg-neutral-950 flex flex-col shrink-0">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h1 className="font-bold text-lg text-neutral-100 tracking-wide">StudyNet</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-neutral-400 hover:text-white transition-colors rounded-lg hover:bg-neutral-800"
              title="Einstellungen"
            >
              <Settings className="w-4.5 h-4.5" />
            </button>
            <button className="md:hidden p-2 text-neutral-400 hover:text-white">
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="p-4 space-y-2 hidden md:block">
          <button 
            onClick={handleSelectFolder}
            className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            <FolderOpen className="w-4 h-4" />
            Ordner wählen
          </button>
          <button 
            onClick={handleClearDatabase}
            className="w-full py-2 px-3 bg-red-900/20 hover:bg-red-900/40 border border-red-900/50 text-red-400 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            <Trash2 className="w-4 h-4" />
            Datenbank leeren
          </button>
        </div>

        {/* Filters */}
        <div className="p-2 md:p-4 flex md:flex-col gap-2 overflow-x-auto">
          <div className="md:hidden text-xs font-semibold text-neutral-500 uppercase flex items-center shrink-0 px-2">Filter:</div>
          <button 
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-left whitespace-nowrap min-h-[44px] ${filter === 'all' ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-400 hover:bg-neutral-900'}`}
          >
            Alle Dokumente
          </button>
          <button 
            onClick={() => setFilter('recent')}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-left whitespace-nowrap min-h-[44px] ${filter === 'recent' ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-400 hover:bg-neutral-900'}`}
          >
            Kürzlich gelesen
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          
          {/* Mobile Buttons */}
          <div className="flex justify-between items-center md:hidden mb-4 gap-2">
            <button 
              onClick={handleSelectFolder}
              className="flex-1 py-2 px-4 bg-neutral-900 border border-neutral-700 text-neutral-200 text-sm font-medium rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
            >
              <FolderOpen className="w-4 h-4" />
              Ordner wählen
            </button>
            <button 
              onClick={handleClearDatabase}
              className="py-2 px-4 bg-red-900/20 border border-red-900/50 text-red-400 text-sm font-medium rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Semantische Suchleiste */}
          <SemanticSearchBar />

          {/* Suchergebnisse (nur wenn Suche aktiv) */}
          <SearchResultsView />

          {/* Paper-Bibliothek */}
          <div>
            <h2 className="text-xl font-bold mb-4">Deine Papers</h2>
            {displayedDocs.length === 0 ? (
              <div className="text-center py-12 bg-neutral-900/30 rounded-xl border border-neutral-800 border-dashed">
                <p className="text-neutral-500">Keine Dokumente gefunden.</p>
                <p className="text-xs text-neutral-600 mt-2">Wähle einen Ordner um PDFs zu importieren.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {displayedDocs.map(doc => (
                  <PaperCard 
                    key={doc.id}
                    document={doc}
                    annotationCount={counts[doc.id]?.annos || 0}
                    noteCount={counts[doc.id]?.notes || 0}
                    onClick={() => handleDocumentClick(doc.id)}
                    analysisStatus={analysisStatuses[doc.id] || 'none'}
                    questionCount={questionCounts[doc.id] || 0}
                    onAnalyze={handleAnalyzePaper}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <RecentNotes />
            <AnnotationFeed />
          </div>

        </div>
      </div>

      {/* Settings Panel (Slide-in Modal) */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}
