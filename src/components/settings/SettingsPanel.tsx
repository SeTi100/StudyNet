import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Settings, X, Eye, EyeOff, Check, AlertCircle, Server, RefreshCw, Edit3, Download, Upload, Database, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { exportDatabaseBackup, importDatabaseBackup } from '../../services/backupService';
import { db } from '../../db/schema';

// ── Props ──────────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Modell-Optionen ────────────────────────────────────────────────────────────

const DEFAULT_GEMINI_MODELS = [
  { value: 'gemini-3.7-flash', label: 'gemini-3.7-flash (Empfohlen / Schnell)' },
  { value: 'gemini-3.6-flash', label: 'gemini-3.6-flash' },
  { value: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
  { value: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite (Ultra-Günstig)' },
  { value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite (Ultra-Günstig)' },
  { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
  { value: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
  { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
  { value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b' },
  { value: 'gemini-3.1-pro', label: 'gemini-3.1-pro (Leistungsstark)' },
] as const;

const EMBEDDING_MODELS = [
  { value: 'Xenova/bge-small-en-v1.5', label: 'Xenova/bge-small-en-v1.5 (Standard, 33 MB)' },
  { value: 'Xenova/multilingual-e5-small', label: 'Xenova/multilingual-e5-small (Mehrsprachig, 80 MB)' },
  { value: 'Xenova/all-MiniLM-L6-v2', label: 'Xenova/all-MiniLM-L6-v2 (Kompakt, 23 MB)' },
] as const;

// ── Komponente ─────────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const {
    geminiApiKey,
    geminiModel,
    embeddingModel,
    geminiSystemPrompt,
    questionsPerChunk,
    targetChunkSize,
    deduplicationThreshold,
    geminiFallbackModel,
    maxRetriesPerModel,
    useRemoteEmbedding,
    remoteEmbeddingUrl,
    setGeminiApiKey,
    setGeminiModel,
    setEmbeddingModel,
    setGeminiSystemPrompt,
    setQuestionsPerChunk,
    setTargetChunkSize,
    setDeduplicationThreshold,
    setGeminiFallbackModel,
    setMaxRetriesPerModel,
    setUseRemoteEmbedding,
    setRemoteEmbeddingUrl,
  } = useSettingsStore();

  // Lokaler UI-State
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [fetchedModels, setFetchedModels] = useState<{ value: string; label: string }[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBackupExport = async () => {
    setIsExporting(true);
    setBackupStatus(null);
    try {
      await exportDatabaseBackup();
      setBackupStatus('Backup erfolgreich heruntergeladen!');
    } catch (e: any) {
      setBackupStatus(`Fehler beim Export: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setBackupStatus('Importiere Backup...');
    try {
      const res = await importDatabaseBackup(file);
      setBackupStatus(
        `Erfolgreich! ${res.matchedDocumentsCount} Papers abgeglichen, ${res.importedQuestionsCount} Fragen, ${res.importedNotesCount} Notizen und ${res.importedAnnotationsCount} Markierungen importiert.`
      );
    } catch (err: any) {
      setBackupStatus(`Fehler beim Import: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Dynamische Modelle abrufen ─────────────────────────────────────────────

  const fetchModelsFromApi = useCallback(async (key: string) => {
    if (!key.trim()) return;
    setIsLoadingModels(true);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${key.trim()}`
      );
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.models)) {
          const validModels = data.models
            .filter((m: any) => {
              const methods: string[] = m.supportedGenerationMethods || [];
              return methods.includes('generateContent');
            })
            .map((m: any) => {
              const cleanId = (m.name || '').replace(/^models\//, '');
              const displayName = m.displayName ? ` (${m.displayName})` : '';
              return {
                value: cleanId,
                label: `${cleanId}${displayName}`,
              };
            });
          if (validModels.length > 0) {
            setFetchedModels(validModels);
          }
        }
      }
    } catch (e) {
      console.warn('Modelle konnten nicht geladen werden:', e);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  // Beim Öffnen versuchen, Modelle abzurufen, wenn ein Key da ist
  useEffect(() => {
    if (isOpen && geminiApiKey.trim() && fetchedModels.length === 0) {
      fetchModelsFromApi(geminiApiKey);
    }
  }, [isOpen, geminiApiKey, fetchModelsFromApi, fetchedModels.length]);

  // ── API-Key Validierung ────────────────────────────────────────────────────

  const handleTestApiKey = useCallback(async () => {
    const key = geminiApiKey.trim();
    if (!key) {
      setTestStatus('error');
      setTestError('Bitte gib einen API Key ein.');
      return;
    }

    setTestStatus('loading');
    setTestError('');

    const cleanModel = (geminiModel || 'gemini-1.5-flash').trim().replace(/^models\//, '');

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with: OK' }] }],
          }),
        }
      );

      if (response.ok) {
        setTestStatus('success');
        // Nach erfolgreichem Test auch die verfügbaren Modelle laden
        fetchModelsFromApi(key);
      } else {
        const data = await response.json().catch(() => null);
        const message = data?.error?.message ?? `HTTP ${response.status}: ${response.statusText}`;
        setTestStatus('error');
        setTestError(message);
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Netzwerkfehler');
    }
  }, [geminiApiKey, geminiModel, fetchModelsFromApi]);

  // ── Backdrop-Klick ─────────────────────────────────────────────────────────

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const modelOptions = fetchedModels.length > 0 ? fetchedModels : DEFAULT_GEMINI_MODELS;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay + Backdrop */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          isOpen
            ? 'opacity-100 pointer-events-auto'
            : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleBackdropClick}
      >
        {/* Semi-transparenter Hintergrund */}
        <div className="absolute inset-0 bg-black/60" />

        {/* Slide-in Panel */}
        <aside
          className={`absolute right-0 top-0 h-full w-96 bg-neutral-900 border-l border-neutral-800
            shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
              isOpen ? 'translate-x-0' : 'translate-x-full'
            }`}
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-neutral-400" />
              <h2 className="text-lg font-semibold text-neutral-100">Einstellungen</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-100
                hover:bg-neutral-800 transition-colors"
              aria-label="Schließen"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* ── Scrollbarer Inhalt ──────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

            {/* ─── Sektion 1: LLM-Konfiguration ────────────────────────── */}
            <section className="pb-6 border-b border-neutral-800">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-4">
                LLM-Konfiguration (Fragengenerierung)
              </h3>

              {/* Gemini API Key */}
              <div className="mb-4">
                <label
                  htmlFor="settings-api-key"
                  className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                >
                  Gemini API Key
                </label>
                <div className="relative">
                  <input
                    id="settings-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={geminiApiKey}
                    onChange={(e) => {
                      setGeminiApiKey(e.target.value);
                      // Status zurücksetzen bei Änderung
                      if (testStatus !== 'idle') setTestStatus('idle');
                    }}
                    placeholder="AIza..."
                    className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                      rounded-lg px-3 py-2 pr-10 text-sm placeholder-neutral-500
                      focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                      transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500
                      hover:text-neutral-300 transition-colors"
                    aria-label={showApiKey ? 'API Key verbergen' : 'API Key anzeigen'}
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-neutral-500">
                  Dein Key wird lokal im Browser gespeichert.
                </p>
              </div>

              {/* Modell-Auswahl */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="settings-model"
                    className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide"
                  >
                    Modell
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fetchModelsFromApi(geminiApiKey)}
                      disabled={isLoadingModels || !geminiApiKey.trim()}
                      className="text-neutral-500 hover:text-blue-400 disabled:opacity-30 transition-colors flex items-center gap-1 text-[11px]"
                      title="Verfügbare Modelle vom Account abrufen"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingModels ? 'animate-spin' : ''}`} />
                      <span>{isLoadingModels ? 'Lade…' : 'Aktualisieren'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCustomModel(!isCustomModel)}
                      className="text-neutral-500 hover:text-blue-400 transition-colors flex items-center gap-1 text-[11px]"
                      title="Eigenen Modell-Namen manuell eintragen"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>{isCustomModel ? 'Auswahlliste' : 'Manuell'}</span>
                    </button>
                  </div>
                </div>

                {isCustomModel ? (
                  <input
                    type="text"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    placeholder="z.B. gemini-1.5-flash oder gemini-2.0-flash-exp"
                    className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                      rounded-lg px-3 py-2 text-sm placeholder-neutral-500
                      focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                      transition-colors"
                  />
                ) : (
                  <select
                    id="settings-model"
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                      rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none
                      focus:ring-1 focus:ring-blue-500 transition-colors appearance-none
                      cursor-pointer"
                  >
                    {modelOptions.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
                {fetchedModels.length > 0 && (
                  <p className="mt-1 text-[11px] text-green-500/80">
                    ✓ {fetchedModels.length} für deinen API-Key verfügbare Modelle geladen
                  </p>
                )}
              </div>

              {/* Fallback-Modell Auswahl */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="settings-fallback-model"
                    className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide"
                  >
                    Fallback-Modell (API-Überlastung)
                  </label>
                </div>
                <select
                  id="settings-fallback-model"
                  value={geminiFallbackModel}
                  onChange={(e) => setGeminiFallbackModel(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                    rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none
                    focus:ring-1 focus:ring-blue-500 transition-colors appearance-none
                    cursor-pointer"
                >
                  {modelOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max Retries */}
              <div className="mb-5">
                <label
                  htmlFor="settings-retries"
                  className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                >
                  Retry-Versuche pro Modell
                </label>
                <input
                  id="settings-retries"
                  type="number"
                  min={0}
                  max={5}
                  value={maxRetriesPerModel}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 0 && n <= 5) setMaxRetriesPerModel(n);
                  }}
                  className="w-24 bg-neutral-800 border border-neutral-700 text-neutral-100
                    rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none
                    focus:ring-1 focus:ring-blue-500 transition-colors"
                />
                <p className="mt-1 text-[10px] text-neutral-500 leading-tight">
                  Anzahl der Wiederholungsversuche bei Timeout/Rate-Limits (Standard: 1).
                </p>
              </div>

              {/* Key testen */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestApiKey}
                  disabled={testStatus === 'loading'}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                    disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg
                    transition-colors"
                >
                  {testStatus === 'loading' ? 'Teste…' : 'Key testen'}
                </button>

                {testStatus === 'success' && (
                  <span className="flex items-center gap-1 text-green-400 text-sm">
                    <Check className="w-4 h-4" />
                    Verbindung OK
                  </span>
                )}

                {testStatus === 'error' && (
                  <span className="flex items-center gap-1 text-red-400 text-sm max-w-[220px] truncate">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate" title={testError}>{testError}</span>
                  </span>
                )}
              </div>
            </section>

            {/* ─── Sektion 2: Embedding-Modell ──────────────────────────── */}
            <section className="pb-6 border-b border-neutral-800">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-4">
                Embedding-Modell
              </h3>

              {/* Lokales Modell */}
              <div className="mb-4">
                <label
                  htmlFor="settings-embedding"
                  className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                >
                  Lokales Modell
                </label>
                <select
                  id="settings-embedding"
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                    rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none
                    focus:ring-1 focus:ring-blue-500 transition-colors appearance-none
                    cursor-pointer"
                >
                  {EMBEDDING_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Remote-Embedding Toggle */}
              <div className="mb-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={useRemoteEmbedding}
                      onChange={(e) => setUseRemoteEmbedding(e.target.checked)}
                      className="sr-only peer"
                    />
                    {/* Toggle-Track */}
                    <div
                      className="w-9 h-5 bg-neutral-700 rounded-full
                        peer-checked:bg-blue-600 peer-focus-visible:ring-2
                        peer-focus-visible:ring-blue-500 transition-colors"
                    />
                    {/* Toggle-Thumb */}
                    <div
                      className="absolute top-0.5 left-0.5 w-4 h-4 bg-neutral-300 rounded-full
                        shadow transition-transform peer-checked:translate-x-4"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-neutral-500 group-hover:text-neutral-400 transition-colors" />
                    <span className="text-sm text-neutral-200 select-none">
                      Dedizierten Server nutzen
                    </span>
                  </div>
                </label>
              </div>

              {/* Remote-Embedding URL (bedingt sichtbar) */}
              {useRemoteEmbedding && (
                <div className="ml-12 mt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <label
                    htmlFor="settings-remote-url"
                    className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                  >
                    Server-URL
                  </label>
                  <input
                    id="settings-remote-url"
                    type="url"
                    value={remoteEmbeddingUrl}
                    onChange={(e) => setRemoteEmbeddingUrl(e.target.value)}
                    placeholder="http://localhost:8000/embed"
                    className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                      rounded-lg px-3 py-2 text-sm placeholder-neutral-500
                      focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500
                      transition-colors"
                  />
                  <p className="mt-1 text-xs text-neutral-500">
                    Docker-Container oder lokaler FastAPI-Server
                  </p>
                </div>
              )}
            </section>

            {/* ─── Sektion 3: Fragengenerierung ─────────────────────────── */}
            <section className="pb-6">
              <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-4">
                Fragengenerierung
              </h3>

              {/* System Prompt (Few-Shot) */}
              <div className="mb-5">
                <label
                  htmlFor="settings-system-prompt"
                  className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                >
                  System Prompt (Few-Shot)
                </label>
                <textarea
                  id="settings-system-prompt"
                  value={geminiSystemPrompt}
                  onChange={(e) => setGeminiSystemPrompt(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 text-neutral-100
                    rounded-lg px-3 py-2 text-xs focus:border-blue-500 focus:outline-none
                    focus:ring-1 focus:ring-blue-500 transition-colors"
                  rows={14}
                />
                <p className="mt-1 text-[10px] text-neutral-500 leading-tight">
                  Definiere die Persona und gib konkrete JSON-Beispiele (Few-Shot) an, um die Qualität der Fragen drastisch zu verbessern.
                </p>
              </div>

              {/* Fragen pro Textabschnitt */}
              <div className="mb-5">
                <label
                  htmlFor="settings-questions"
                  className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-1.5"
                >
                  Fragen pro Textabschnitt
                </label>
                <input
                  id="settings-questions"
                  type="number"
                  min={2}
                  max={8}
                  value={questionsPerChunk}
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n) && n >= 2 && n <= 8) setQuestionsPerChunk(n);
                  }}
                  className="w-24 bg-neutral-800 border border-neutral-700 text-neutral-100
                    rounded-lg px-3 py-2 text-sm focus:border-blue-500 focus:outline-none
                    focus:ring-1 focus:ring-blue-500 transition-colors"
                />
                <p className="mt-1 text-[10px] text-neutral-500 leading-tight">
                  Anzahl der Fragen, die die KI pro Chunk generiert (Standard: 4).
                </p>
              </div>

              {/* Ziel-Chunkgröße (Tokens) */}
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="settings-chunk-size"
                    className="block text-xs font-semibold text-neutral-400 uppercase tracking-wide"
                  >
                    Ziel-Chunkgröße (Tokens)
                  </label>
                  <span className="text-sm font-mono text-blue-400">
                    {targetChunkSize || 500} Tokens
                  </span>
                </div>
                <input
                  id="settings-chunk-size"
                  type="range"
                  min={250}
                  max={2000}
                  step={50}
                  value={targetChunkSize || 500}
                  onChange={(e) => setTargetChunkSize(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer
                    accent-blue-500
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-4
                    [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-blue-500
                    [&::-webkit-slider-thumb]:shadow-md
                    [&::-webkit-slider-thumb]:cursor-pointer"
                />
                <p className="mt-1 text-[10px] text-neutral-500 leading-tight">
                  Steuert die Textlänge pro Abschnitt. Größere Chunks (z.B. 1000–1200 Tokens) reduzieren die Anzahl der API-Aufrufe und sparen drastisch Input-Tokens.
                </p>
              </div>

              {/* Deduplizierungs-Schwellenwert */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="settings-threshold"
                    className="text-xs font-semibold text-neutral-400 uppercase tracking-wide"
                  >
                    Deduplizierungs-Schwellenwert
                  </label>
                  <span className="text-sm font-mono text-blue-400">
                    {deduplicationThreshold.toFixed(2)}
                  </span>
                </div>
                <input
                  id="settings-threshold"
                  type="range"
                  min={0.80}
                  max={0.95}
                  step={0.01}
                  value={deduplicationThreshold}
                  onChange={(e) => setDeduplicationThreshold(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer
                    accent-blue-500
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-4
                    [&::-webkit-slider-thumb]:h-4
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-blue-500
                    [&::-webkit-slider-thumb]:hover:bg-blue-400
                    [&::-webkit-slider-thumb]:transition-colors"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-neutral-600">0.80</span>
                  <span className="text-xs text-neutral-600">0.95</span>
                </div>
              </div>
            </section>

            {/* ── Backup & Datenverwaltung ─────────────────────────────────── */}
            <section className="space-y-4 pt-2 border-t border-neutral-800">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-neutral-200">
                  Backup & Datenverwaltung
                </h3>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Exportiere alle generierten Fragen, Notizen, Markierungen und Zitationen als JSON. 
                Nach dem Leeren der Datenbank kannst du sie jederzeit wieder importieren – der Abgleich erfolgt automatisch per DOI oder Titel.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleBackupExport}
                  disabled={isExporting || isImporting}
                  className="w-full py-2.5 px-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 border border-neutral-700 text-neutral-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  {isExporting ? <Loader2 className="w-4 h-4 animate-spin text-blue-400" /> : <Download className="w-4 h-4 text-blue-400" />}
                  <span>Backup exportieren</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExporting || isImporting}
                  className="w-full py-2.5 px-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 border border-neutral-700 text-neutral-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  {isImporting ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Upload className="w-4 h-4 text-emerald-400" />}
                  <span>Backup importieren</span>
                </button>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleBackupImport}
                accept=".json"
                className="hidden"
              />

              {backupStatus && (
                <div className="bg-neutral-800/80 border border-neutral-700 rounded-lg p-2.5 text-xs text-neutral-300">
                  {backupStatus}
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </>
  );
};
