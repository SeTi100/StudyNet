import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, Loader2, Brain, AlertCircle } from 'lucide-react';
import { useSemanticSearchStore } from '../../store/useSemanticSearchStore';

/**
 * Globale semantische Suchleiste für das Dashboard.
 * Sucht über alle generierten Fragen aller Paper hinweg
 * mittels Hybrid-Suche (Vektor + BM25).
 */
export const SemanticSearchBar: React.FC = () => {
  const {
    query,
    isSearching,
    isEmbeddingReady,
    isInitialized,
    totalQuestions,
    totalPapers,
    error,
    downloadProgress,
    search,
    clearSearch,
    initializeSearch,
  } = useSemanticSearchStore();

  const [inputValue, setInputValue] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Embedding-Modell beim ersten Rendern initialisieren
  useEffect(() => {
    if (!isInitialized && !isEmbeddingReady) {
      initializeSearch();
    }
  }, [isInitialized, isEmbeddingReady, initializeSearch]);

  // Debounced Suche (300ms)
  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!value.trim()) {
        clearSearch();
        return;
      }

      debounceRef.current = setTimeout(() => {
        search(value.trim());
      }, 300);
    },
    [search, clearSearch]
  );

  const handleClear = useCallback(() => {
    setInputValue('');
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClear();
      }
      if (e.key === 'Enter' && inputValue.trim()) {
        // Sofort suchen bei Enter
        if (debounceRef.current) clearTimeout(debounceRef.current);
        search(inputValue.trim());
      }
    },
    [handleClear, inputValue, search]
  );

  // Status-Text für den Platzhalter
  const getPlaceholder = (): string => {
    if (!isEmbeddingReady && !isInitialized) return 'Embedding-Modell wird geladen...';
    if (totalQuestions === 0) return 'Noch keine Paper analysiert – Starte eine Analyse';
    return `Semantisch suchen in ${totalQuestions} Fragen aus ${totalPapers} Papern...`;
  };

  return (
    <div className="w-full">
      <div className="relative flex items-center">
        {/* Such-Icon oder Ladeindikator */}
        <div className="absolute left-3 pointer-events-none">
          {isSearching ? (
            <Loader2 className="w-4.5 h-4.5 text-blue-400 animate-spin" />
          ) : (
            <Search className="w-4.5 h-4.5 text-neutral-400" />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          disabled={!isEmbeddingReady}
          className="w-full bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder-neutral-500 text-sm rounded-xl pl-10 pr-20 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        />

        {/* Rechte Seite: Status-Badges und Clear-Button */}
        <div className="absolute right-3 flex items-center gap-2">
          {/* Embedding-Status-Badge */}
          {isInitialized && isEmbeddingReady && totalQuestions > 0 && !inputValue && (
            <div className="flex items-center gap-1 text-[10px] text-neutral-500">
              <Brain className="w-3 h-3" />
              <span>{totalQuestions}</span>
            </div>
          )}

          {/* Clear-Button */}
          {inputValue && (
            <button
              onClick={handleClear}
              className="text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Fehleranzeige */}
      {error && (
        <div className="mt-2 flex items-center gap-2 text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Lade-Indikator beim ersten Initialisieren mit Prozent & Fortschrittsbalken */}
      {!isInitialized && !error && (
        <div className="mt-2 p-3 bg-neutral-900/80 border border-neutral-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
              <span className="truncate max-w-[200px]" title={downloadProgress?.file || ''}>
                {downloadProgress?.file
                  ? `Lade ${downloadProgress.file}...`
                  : 'Embedding-Modell initialisiert...'}
              </span>
            </div>
            {typeof downloadProgress?.progress === 'number' && (
              <span className="font-mono text-blue-400 font-medium whitespace-nowrap mr-2">
                {downloadProgress.progress}%
              </span>
            )}
            {(downloadProgress as any)?.loaded ? (
              <span className="text-neutral-500 font-mono text-[10px] whitespace-nowrap">
                {((downloadProgress as any).loaded / 1024 / 1024).toFixed(1)}
                {(downloadProgress as any)?.total ? ` / ${((downloadProgress as any).total / 1024 / 1024).toFixed(1)} MB` : ' MB geladen'}
              </span>
            ) : null}
          </div>

          {/* Fortschrittsbalken */}
          <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden flex">
            <div
              className={`h-full bg-blue-500 transition-all duration-300 ${
                typeof downloadProgress?.progress !== 'number' ? 'animate-pulse w-full bg-blue-500/50' : ''
              }`}
              style={{
                width:
                  typeof downloadProgress?.progress === 'number'
                    ? `${downloadProgress.progress}%`
                    : undefined,
              }}
            />
          </div>
          <p className="text-[10px] text-neutral-500 mt-1">
            Lädt ca. 120MB Modell-Daten. Wird lokal im Browser-Cache gespeichert – ab dem 2. Mal sofort bereit (auch offline).
          </p>
        </div>
      )}
    </div>
  );
};
