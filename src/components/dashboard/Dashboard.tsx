import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDocumentStore } from '../../store/useDocumentStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { openSourceFolder } from '../../utils/opfsStorage';
import { PaperCard } from './PaperCard';
import { RecentNotes } from './RecentNotes';
import { AnnotationFeed } from './AnnotationFeed';
import { SemanticSearchBar } from '../search/SemanticSearchBar';
import { SearchResultsView } from '../search/SearchResultsView';
import { SettingsPanel } from '../settings/SettingsPanel';
import { FolderOpen, Plus, Search, Filter, Trash2, Settings, Loader2, Download, Upload, CheckCircle, Brain, Zap, Sparkles, ShieldCheck } from 'lucide-react';
import { db, DocumentRecord } from '../../db/schema';
import { useSemanticSearchStore } from '../../store/useSemanticSearchStore';
import { exportDatabaseBackup, importDatabaseBackup } from '../../services/backupService';
import type { IngestionProgress } from '../../services/questionGenerationService';
import { formatTokenCount, formatCostUsd } from '../../utils/tokenCostCalculator';

/** Status der KI-Analyse pro Dokument */
type AnalysisStatus = 'none' | 'analyzing' | 'done' | 'needs_reparse';

export function Dashboard() {
  const { documents, loadDocuments, setFolderHandle, scanFolder, isScanning, scanProgress } = useDocumentStore();
  const hasApiKey = useSettingsStore((s) => s.hasApiKey);
  const [filter, setFilter] = useState<'all' | 'recent' | 'tags'>('all');
  const [counts, setCounts] = useState<Record<string, { notes: number; annos: number }>>({});
  const [questionCounts, setQuestionCounts] = useState<Record<string, number>>({});
  const [analysisStatuses, setAnalysisStatuses] = useState<Record<string, AnalysisStatus>>({});
  const [analyzingDoc, setAnalyzingDoc] = useState<{ id: string; title: string } | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<IngestionProgress | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const fileImportRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 6000);
  };

  const handleExportBackup = async () => {
    try {
      await exportDatabaseBackup();
      showToast('Backup erfolgreich als JSON exportiert!');
    } catch (e: any) {
      alert(`Fehler beim Exportieren: ${e.message}`);
    }
  };

  const loadCounts = useCallback(async () => {
    const newCounts: Record<string, { notes: number; annos: number }> = {};
    const newQuestionCounts: Record<string, number> = {};
    const newStatuses: Record<string, AnalysisStatus> = {};

    const allDocs = await db.documents.toArray();
    for (const doc of allDocs) {
      const notes = await db.notes.where('documentId').equals(doc.id).count();
      const annos = await db.annotations.where('documentId').equals(doc.id).count();
      const questions = await db.paperQuestions.where('documentId').equals(doc.id).count();
      const chunks = await db.documentChunks.where('documentId').equals(doc.id).count();

      newCounts[doc.id] = { notes, annos };
      newQuestionCounts[doc.id] = questions;
      
      if (questions > 0 && chunks === 0) {
        newStatuses[doc.id] = 'needs_reparse';
      } else if (questions > 0) {
        newStatuses[doc.id] = 'done';
      } else {
        newStatuses[doc.id] = 'none';
      }
    }

    setCounts(newCounts);
    setQuestionCounts(newQuestionCounts);
    setAnalysisStatuses(newStatuses);
  }, []);

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const res = await importDatabaseBackup(file);
      showToast(
        `Import abgeschlossen! ${res.matchedDocumentsCount} Papers abgeglichen, ${res.importedQuestionsCount} Fragen, ${res.importedNotesCount} Notizen und ${res.importedAnnotationsCount} Markierungen importiert.`
      );
      await loadCounts();
    } catch (err: any) {
      alert(`Import fehlgeschlagen: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (fileImportRef.current) fileImportRef.current.value = '';
    }
  };

  const handleClearDatabase = async () => {
    if (window.confirm('Bist du sicher? Alle lokal gespeicherten Papers und Notizen werden aus der Datenbank gelöscht (Die Original-PDFs auf deinem PC bleiben erhalten).')) {
      await db.documents.clear();
      await db.annotations.clear();
      await db.notes.clear();
      await db.citations.clear();
      await db.paperQuestions.clear();
      await loadDocuments();
      await loadCounts();
      try {
        await useSemanticSearchStore.getState().initializeSearch();
      } catch (e) {
        // ignore
      }
      showToast('Datenbank wurde geleert.');
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Lade Annotations-/Notizen-Zähler UND Fragen-Zähler
  useEffect(() => {
    if (documents.length > 0) {
      loadCounts();
    }
  }, [documents, loadCounts]);

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

      // Alte Daten (Fragen und Chunks) für dieses Dokument löschen (für sauberes Re-Parsing)
      await db.transaction('rw', db.paperQuestions, db.documentChunks, async () => {
        await db.paperQuestions.where('documentId').equals(documentId).delete();
        await db.documentChunks.where('documentId').equals(documentId).delete();
      });

      // Text via pdfjs extrahieren mit intelligenter Normalisierung
      const pdfjsLib = await import('pdfjs-dist');
      const pdfWorkerUrl = await import('pdfjs-dist/build/pdf.worker.mjs?url');
      const { extractCleanPageText } = await import('../../utils/textNormalization');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl.default;
      
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      const pageTexts: Record<number, string> = {};

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        pageTexts[i] = await extractCleanPageText(page);
      }

      // Embedding Worker aus dem SearchStore holen
      const searchStore = useSemanticSearchStore.getState();
      if (!searchStore.isEmbeddingReady) {
        // Falls noch nicht geladen, initialisieren
        await searchStore.initializeSearch();
      }
      
      const embeddingWorker = useSemanticSearchStore.getState().embeddingWorker;
      if (!embeddingWorker) throw new Error('Embedding Worker nicht verfügbar');

      setAnalyzingDoc({ id: documentId, title: doc.title });
      setAnalysisProgress({ phase: 'chunking' });

      // Fragen generieren
      const results = await generateQuestionsForDocument(
        documentId,
        pageTexts,
        embeddingWorker,
        (progress) => {
          setAnalysisProgress(progress);
        }
      );

      // Status aktualisieren
      setQuestionCounts((prev) => ({ ...prev, [documentId]: results.length }));
      setAnalysisStatuses((prev) => ({ ...prev, [documentId]: 'done' }));

      // Dokumentenliste und Zähler neu laden, um das tokenUsage-Badge sofort anzuzeigen
      await loadDocuments();
      await loadCounts();

      // Suchindex aktualisieren (damit neue Fragen direkt suchbar sind)
      // Wir setzen isInitialized kurz auf false, damit der Progress-Bar falls nötig gezeigt wird
      useSemanticSearchStore.setState({ isInitialized: false });
      await useSemanticSearchStore.getState().initializeSearch();

      showToast(`Analyse für "${doc.title}" erfolgreich abgeschlossen (${results.length} Fragen)!`);

    } catch (err) {
      console.error('Analyse fehlgeschlagen:', err);
      setAnalysisStatuses((prev) => ({ ...prev, [documentId]: 'none' }));
      alert(`Analyse fehlgeschlagen: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`);
    } finally {
      setAnalyzingDoc(null);
      setAnalysisProgress(null);
    }
  }, [documents, hasApiKey, loadDocuments, loadCounts]);

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
            disabled={isScanning || isImporting}
            className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 border border-neutral-700 text-neutral-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            {isScanning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                <span>Analysiere Ordner...</span>
              </>
            ) : (
              <>
                <FolderOpen className="w-4 h-4" />
                <span>Ordner wählen</span>
              </>
            )}
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleExportBackup}
              disabled={isScanning || isImporting}
              className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 border border-neutral-700 text-neutral-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors min-h-[38px]"
              title="Datenbank (Analysen, Fragen, Notizen & Markierungen) als JSON sichern"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Export</span>
            </button>
            <button
              onClick={() => fileImportRef.current?.click()}
              disabled={isScanning || isImporting}
              className="py-2 px-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 border border-neutral-700 text-neutral-300 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors min-h-[38px]"
              title="Gespeichertes Backup importieren (verknüpft via DOI, Pfad oder Titel)"
            >
              {isImporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>Import</span>
            </button>
          </div>

          <button 
            onClick={handleClearDatabase}
            disabled={isScanning || isImporting}
            className="w-full py-2 px-3 bg-red-900/20 hover:bg-red-900/40 disabled:opacity-50 border border-red-900/50 text-red-400 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px]"
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
          <div className="flex items-center md:hidden mb-4 gap-2">
            <button 
              onClick={handleSelectFolder}
              disabled={isScanning || isImporting}
              className="flex-1 py-2 px-3 bg-neutral-900 border border-neutral-700 disabled:opacity-50 text-neutral-200 text-sm font-medium rounded-lg flex items-center justify-center gap-2 min-h-[44px]"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Analysiere...</span>
                </>
              ) : (
                <>
                  <FolderOpen className="w-4 h-4" />
                  <span>Ordner</span>
                </>
              )}
            </button>
            <button
              onClick={handleExportBackup}
              disabled={isScanning || isImporting}
              className="py-2 px-3 bg-neutral-900 border border-neutral-700 disabled:opacity-50 text-neutral-200 text-sm font-medium rounded-lg flex items-center justify-center min-h-[44px]"
              title="Backup exportieren"
            >
              <Download className="w-4 h-4 text-blue-400" />
            </button>
            <button
              onClick={() => fileImportRef.current?.click()}
              disabled={isScanning || isImporting}
              className="py-2 px-3 bg-neutral-900 border border-neutral-700 disabled:opacity-50 text-neutral-200 text-sm font-medium rounded-lg flex items-center justify-center min-h-[44px]"
              title="Backup importieren"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-emerald-400" />}
            </button>
            <button 
              onClick={handleClearDatabase}
              disabled={isScanning || isImporting}
              className="py-2 px-3 bg-red-900/20 border border-red-900/50 text-red-400 text-sm font-medium rounded-lg flex items-center justify-center min-h-[44px]"
              title="Datenbank leeren"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Hidden File Input for Backup Import */}
          <input
            type="file"
            ref={fileImportRef}
            onChange={handleImportFileSelected}
            accept=".json"
            className="hidden"
          />

          {/* Toast Notification */}
          {toastMessage && (
            <div className="bg-emerald-950/90 border border-emerald-700/80 rounded-xl p-3.5 flex items-center gap-3 text-emerald-200 text-xs shadow-xl animate-in fade-in slide-in-from-top-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="flex-1 font-medium">{toastMessage}</span>
              <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-white text-sm font-bold ml-2">✕</button>
            </div>
          )}

          {/* Semantische Suchleiste */}
          <SemanticSearchBar />

          {/* Suchergebnisse (nur wenn Suche aktiv) */}
          <SearchResultsView />

          {/* Live KI-Analyse & Token Tracker Banner */}
          {analyzingDoc && analysisProgress && (
            <div className="bg-gradient-to-br from-purple-950/90 via-neutral-900/95 to-neutral-900/90 border border-purple-800/80 rounded-2xl p-5 shadow-2xl backdrop-blur-md flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-300">
              {/* Header: Status & Dokument */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-purple-300 text-xs font-semibold uppercase tracking-wider mb-1">
                    <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
                    <span>KI-Analyse läuft</span>
                    <span className="text-neutral-500">•</span>
                    <span className="text-neutral-300 font-mono font-normal">
                      {analysisProgress.phase === 'chunking' && 'Textabschnitte vorbereiten...'}
                      {analysisProgress.phase === 'generating' && `Fragen generieren (Abschnitt ${analysisProgress.currentChunk || 1} von ${analysisProgress.totalChunks || 1})`}
                      {analysisProgress.phase === 'embedding' && 'Lokale Vektor-Embeddings berechnen...'}
                      {analysisProgress.phase === 'deduplicating' && 'Duplikate filtern...'}
                      {analysisProgress.phase === 'storing' && 'Speichern & Indizieren...'}
                      {analysisProgress.phase === 'done' && 'Fertiggestellt'}
                    </span>
                  </div>
                  <h3 className="text-sm md:text-base font-bold text-white truncate" title={analyzingDoc.title}>
                    {analyzingDoc.title}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-900/60 border border-purple-700/60 text-purple-200 text-xs font-mono shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span className="font-semibold">
                    {analysisProgress.totalChunks && analysisProgress.currentChunk
                      ? `${Math.round((analysisProgress.currentChunk / analysisProgress.totalChunks) * 100)}%`
                      : 'Aktiv'}
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              {analysisProgress.totalChunks && (
                <div className="h-2 w-full bg-neutral-950 rounded-full overflow-hidden border border-purple-900/50">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 transition-all duration-300 rounded-full"
                    style={{
                      width: `${
                        analysisProgress.phase === 'embedding' || analysisProgress.phase === 'storing' || analysisProgress.phase === 'done'
                          ? 100
                          : Math.round(((analysisProgress.currentChunk || 1) / analysisProgress.totalChunks) * 100)
                      }%`,
                    }}
                  />
                </div>
              )}

              {/* Live Token Metrics Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-1">
                {(() => {
                  const totalTokens = analysisProgress.tokenStats?.totalTokens || 0;
                  const outputTokens = analysisProgress.tokenStats?.outputTokens || 0;
                  const displayInputTokens = Math.max(0, totalTokens - outputTokens);
                  return (
                    <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5 flex flex-col">
                      <span className="text-[11px] text-neutral-400 font-medium">
                        Input Tokens
                      </span>
                      <span className="text-sm md:text-base font-mono font-bold text-neutral-100 mt-0.5">
                        {formatTokenCount(displayInputTokens)}
                      </span>
                    </div>
                  );
                })()}

                <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5 flex flex-col">
                  <span className="text-[11px] text-neutral-400 font-medium">
                    Output Tokens
                  </span>
                  <span className="text-sm md:text-base font-mono font-bold text-neutral-100 mt-0.5">
                    {formatTokenCount(analysisProgress.tokenStats?.outputTokens || 0)}
                  </span>
                </div>

                <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5 flex flex-col">
                  <span className="text-[11px] text-neutral-400 flex items-center gap-1 font-medium">
                    <Zap className="w-3 h-3 text-amber-400" /> Gesamt Tokens
                  </span>
                  <span className="text-sm md:text-base font-mono font-bold text-amber-300 mt-0.5">
                    {formatTokenCount(analysisProgress.tokenStats?.totalTokens || 0)}
                  </span>
                </div>

                <div className="bg-neutral-950/70 border border-neutral-800/80 rounded-xl p-2.5 flex flex-col">
                  <span className="text-[11px] text-neutral-400 font-medium">
                    Geschätzte Kosten
                  </span>
                  <span className="text-sm md:text-base font-mono font-bold text-emerald-400 mt-0.5">
                    {formatCostUsd(analysisProgress.tokenStats?.estimatedCostUsd || 0)}
                  </span>
                </div>
              </div>

              {/* Model Info Footer */}
              {analysisProgress.tokenStats?.model && (
                <div className="flex items-center justify-end text-[11px] text-neutral-500 pt-1 border-t border-neutral-800/60 font-mono">
                  Modell: {analysisProgress.tokenStats.model}
                </div>
              )}
            </div>
          )}

          {/* Scanning / Metadata Extraction Banner */}
          {isScanning && (
            <div className="bg-blue-950/80 border border-blue-800/80 rounded-xl p-4 flex flex-col gap-2.5 shadow-lg animate-in fade-in duration-300">
              <div className="flex items-center justify-between text-xs text-blue-200">
                <div className="flex items-center gap-2 font-medium min-w-0">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                  <span className="shrink-0">
                    {scanProgress && scanProgress.total > 0
                      ? `Importiere & analysiere (${scanProgress.current} von ${scanProgress.total}):`
                      : 'Durchsuche Ordner nach PDFs...'}
                  </span>
                  {scanProgress?.currentFileName && (
                    <span className="text-blue-300 font-mono text-[11px] truncate max-w-xs md:max-w-md">
                      {scanProgress.currentFileName}
                    </span>
                  )}
                </div>
                {scanProgress && scanProgress.total > 0 && (
                  <span className="font-mono text-blue-300 font-semibold shrink-0 ml-2">
                    {Math.round((scanProgress.current / scanProgress.total) * 100)}%
                  </span>
                )}
              </div>

              {scanProgress && scanProgress.total > 0 && (
                <div className="h-1.5 w-full bg-blue-950 rounded-full overflow-hidden border border-blue-800/40">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

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
