import { create } from 'zustand';
import { searchEngine, type PaperSearchResult } from '../services/hybridSearchEngine';
import type { QuestionCategory } from '../db/schema';
import { useSettingsStore } from './useSettingsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Nachrichtentypen für die Worker-Kommunikation */
interface WorkerMessage {
  type: string;
  requestId: string;
  [key: string]: unknown;
}

interface WorkerResponse {
  type: string;
  requestId: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// State Interface
// ---------------------------------------------------------------------------

/** Fortschritt des Modell-Downloads */
export interface ModelDownloadProgress {
  status: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/** Zustand-State für die semantische Suche auf dem Dashboard */
export interface SemanticSearchState {
  // State
  query: string;
  results: PaperSearchResult[];
  isSearching: boolean;
  isEmbeddingReady: boolean;
  isInitialized: boolean;
  totalQuestions: number;
  totalPapers: number;
  categoryFilter: QuestionCategory[];
  error: string | null;
  downloadProgress: ModelDownloadProgress | null;

  // Embedding Worker Referenz
  embeddingWorker: Worker | null;

  // Aktionen
  initializeSearch: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  setCategoryFilter: (categories: QuestionCategory[]) => void;
  setError: (error: string | null) => void;
}

// ---------------------------------------------------------------------------
// Helper: Worker-Nachricht senden und auf Antwort warten
// ---------------------------------------------------------------------------

/**
 * Sendet eine Nachricht an den Worker und wartet auf die zugehörige Antwort.
 * Nutzt `requestId` zum Matching von Request und Response.
 */
const sendWorkerMessage = (
  worker: Worker,
  message: WorkerMessage
): Promise<WorkerResponse> => {
  return new Promise((resolve, reject) => {
    const { requestId } = message;

    const handleMessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (!data) return;

      // Fortschritts-Nachrichten sind Zwischen-Updates und keine finalen Antworten
      if (data.type === 'EMBED_PROGRESS' || data.type === 'INIT_PROGRESS') {
        return;
      }

      const msgRequestId = data.requestId || (data as any)?.payload?.requestId;

      // Nur Nachrichten mit passender requestId verarbeiten
      if (msgRequestId && msgRequestId !== requestId) {
        return;
      }

      // Listener entfernen, sobald die Antwort eingetroffen ist
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);

      // Fehlermeldungen vom Worker behandeln
      if (data.type === 'ERROR' || data.type === 'INIT_ERROR' || data.type === 'EMBED_ERROR') {
        console.error('[sendWorkerMessage] received ERROR from worker:', data);
        reject(new Error((data.error as string) ?? (data.payload as any)?.error ?? 'Unbekannter Worker-Fehler'));
        return;
      }

      resolve(data);
    };

    const handleError = (event: ErrorEvent) => {
      console.error('[sendWorkerMessage] received raw ErrorEvent:', event);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      reject(new Error(event.message ?? 'Worker-Fehler'));
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    worker.postMessage(message);
  });
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Zustand-Store für die semantische Suche inkl. Embedding-Worker-Verwaltung */
export const useSemanticSearchStore = create<SemanticSearchState>((set, get) => ({
  // --- Initialer State ---
  query: '',
  results: [],
  isSearching: false,
  isEmbeddingReady: false,
  isInitialized: false,
  totalQuestions: 0,
  totalPapers: 0,
  categoryFilter: [],
  error: null,
  downloadProgress: null,
  embeddingWorker: null,

  // -----------------------------------------------------------------------
  // initializeSearch – Worker starten & Suchindex aufbauen
  // -----------------------------------------------------------------------

  /**
   * Initialisiert die semantische Suche:
   * 1. Erstellt den Embedding-Worker und lädt das Modell
   * 2. Baut den MiniSearch-Index über alle gespeicherten Fragen auf
   */
  initializeSearch: async () => {
    try {
      console.log('[SemanticSearchStore] initializeSearch start...');
      const { embeddingWorker: existingWorker } = get();
      
      let worker = existingWorker;
      if (!worker) {
        console.log('[SemanticSearchStore] Creating new Web Worker...');
        worker = new Worker(
          new URL('../workers/embeddingWorker.ts', import.meta.url),
          { type: 'module' }
        );

        set({ embeddingWorker: worker, error: null });

        worker.addEventListener('message', (e) => {
          const data = e.data || {};
          if (data.type === 'INIT_PROGRESS') {
            const payload = data.payload || data;
            set({
              downloadProgress: {
                status: payload.status || 'loading',
                file: payload.file,
                progress: typeof payload.progress === 'number' ? Math.round(payload.progress) : undefined,
                loaded: payload.loaded,
                total: payload.total,
              },
            });
          }
        });
      } else {
        console.log('[SemanticSearchStore] Using existing Web Worker.');
      }

      // Modellname aus den Einstellungen holen
      const { embeddingModel } = useSettingsStore.getState();

      // Wenn wir den Worker schon hatten, überspringen wir das INIT (da er schon initialisiert ist)
      // Ausnahme: Wenn das Modell gewechselt wurde (für später), müssten wir neu initialisieren.
      // Für jetzt nehmen wir an, der Worker ist bereit.
      if (!existingWorker) {
        const requestId = crypto.randomUUID();
        console.log(`[SemanticSearchStore] Sending INIT to worker with model ${embeddingModel}...`);
        const response = await sendWorkerMessage(worker, {
          type: 'INIT',
          payload: {
            modelName: embeddingModel,
            requestId,
          },
          modelName: embeddingModel,
          requestId,
        });
        console.log(`[SemanticSearchStore] Worker INIT response:`, response);

        if (response.type !== 'INIT_SUCCESS') {
          throw new Error('Worker-Initialisierung fehlgeschlagen');
        }
      }

      console.log('[SemanticSearchStore] Initializing searchEngine (Dexie & MiniSearch)...');
      const { totalQuestions, totalPapers } = await searchEngine.initialize();
      console.log(`[SemanticSearchStore] searchEngine ready. Questions: ${totalQuestions}, Papers: ${totalPapers}`);

      set({
        isEmbeddingReady: true,
        isInitialized: true,
        totalQuestions,
        totalPapers,
        downloadProgress: null,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Initialisierung fehlgeschlagen';
      console.error('[SemanticSearchStore] initializeSearch error:', err);

      set({
        error: message,
        isEmbeddingReady: false,
        isInitialized: false,
        downloadProgress: null,
      });
    }
  },

  // -----------------------------------------------------------------------
  // search – Suchanfrage ausführen
  // -----------------------------------------------------------------------

  /**
   * Führt eine hybride Suche (Vektor + Volltext) für die gegebene Query aus.
   * Erzeugt zuerst ein Embedding über den Worker und durchsucht dann den Index.
   */
  search: async (query: string) => {
    const { embeddingWorker, categoryFilter } = get();

    set({ isSearching: true, query, error: null });

    // Leere Query → Ergebnisse zurücksetzen
    if (!query.trim()) {
      set({ results: [], isSearching: false });
      return;
    }

    if (!embeddingWorker) {
      set({
        error: 'Embedding-Worker nicht initialisiert',
        isSearching: false,
      });
      return;
    }

    try {
      console.log(`[SemanticSearchStore] 1. Requesting embedding for query: "${query}"...`);
      // Embedding für die Suchanfrage erzeugen
      const requestId = crypto.randomUUID();
      const embedResponse = await sendWorkerMessage(embeddingWorker, {
        type: 'EMBED_SINGLE',
        payload: {
          requestId,
          text: query,
        },
        requestId,
        text: query,
      });

      if (embedResponse.type !== 'EMBED_RESULT') {
        throw new Error('Embedding-Berechnung fehlgeschlagen');
      }

      console.log(`[SemanticSearchStore] 2. Embedding received. Running hybrid search...`);
      const anyRes = embedResponse as any;
      const queryEmbedding = (anyRes.payload?.embedding || anyRes.embedding) as number[];

      // Hybride Suche ausführen
      const results = await searchEngine.search(queryEmbedding, query, {
        categoryFilter: categoryFilter.length > 0 ? categoryFilter : undefined,
      });

      console.log(`[SemanticSearchStore] 3. Search complete. Found ${results.length} results.`);
      set({ results, isSearching: false });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Suche fehlgeschlagen';
      console.error('[SemanticSearchStore] search error:', err);

      set({ error: message, isSearching: false });
    }
  },

  // -----------------------------------------------------------------------
  // clearSearch – Suchzustand zurücksetzen
  // -----------------------------------------------------------------------

  /** Setzt Query, Ergebnisse und Fehler auf die Standardwerte zurück */
  clearSearch: () => {
    set({ query: '', results: [], error: null, isSearching: false });
  },

  // -----------------------------------------------------------------------
  // setCategoryFilter – Kategoriefilter setzen
  // -----------------------------------------------------------------------

  /**
   * Aktualisiert den Kategoriefilter. Wenn eine aktive Suchanfrage existiert,
   * wird die Suche automatisch erneut ausgeführt.
   */
  setCategoryFilter: (categories: QuestionCategory[]) => {
    set({ categoryFilter: categories });

    // Bei aktiver Query die Suche neu ausführen
    const { query } = get();
    if (query.trim()) {
      // Suche asynchron neu starten (fire-and-forget)
      get().search(query);
    }
  },

  // -----------------------------------------------------------------------
  // setError – Fehlermeldung setzen oder löschen
  // -----------------------------------------------------------------------

  /** Setzt oder löscht die Fehlermeldung im Store */
  setError: (error: string | null) => {
    set({ error });
  },
}));
