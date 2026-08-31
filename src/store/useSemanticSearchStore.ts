import { create } from 'zustand';
import { searchEngine, type PaperSearchResult } from '../services/hybridSearchEngine';
import { searchUserNotesAndAnnotations, type UserContentMatch } from '../services/userContentSearchService';
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
  totalChunks: number;
  totalQuestions: number;
  totalPapers: number;
  categoryFilter: QuestionCategory[];
  userMatches: UserContentMatch[];
  showUserMatches: boolean;

  // Embedding Worker Referenz
  embeddingWorker: Worker | null;

  // Aktionen
  initializeSearch: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  setCategoryFilter: (categories: QuestionCategory[]) => void;
  toggleShowUserMatches: () => void;
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
  userMatches: [],
  showUserMatches: true,
  isSearching: false,
  isEmbeddingReady: false,
  isInitialized: false,
  totalChunks: 0,
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
   * 2. Baut den MiniSearch-Index über alle gespeicherten Chunks und Fragen auf
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
        set({ embeddingWorker: worker });
      }

      // Modellname aus den Einstellungen holen
      const { embeddingModel } = useSettingsStore.getState();

      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'INIT_PROGRESS') {
          set({ downloadProgress: payload as ModelDownloadProgress });
        }
      };

      // Wenn wir den Worker schon hatten, überspringen wir das INIT
      if (!existingWorker) {
        await sendWorkerMessage(worker, {
          type: 'INIT_MODEL',
          payload: { modelName: embeddingModel },
          requestId: crypto.randomUUID(),
        });
      }

      set({ isEmbeddingReady: true, downloadProgress: null });

      console.log('[SemanticSearchStore] Initializing searchEngine (Dexie & MiniSearch)...');
      const stats = await searchEngine.initialize();
      console.log(`[SemanticSearchStore] searchEngine ready. Chunks: ${stats.totalChunks}, Questions: ${stats.totalQuestions}, Papers: ${stats.totalPapers}`);

      set({
        isInitialized: true,
        totalChunks: stats.totalChunks,
        totalQuestions: stats.totalQuestions,
        totalPapers: stats.totalPapers,
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
   * Führt eine hybride Suche (Vektor + Volltext) für die gegebene Query aus
   * und durchsucht parallel persönliche Notizen und Annotationen.
   */
  search: async (query: string) => {
    const { embeddingWorker, categoryFilter } = get();

    set({ isSearching: true, query, error: null });

    // Leere Query → Ergebnisse zurücksetzen
    if (!query.trim()) {
      set({ results: [], userMatches: [], isSearching: false });
      return;
    }

    // Parallele Suche: 1. Persönliche Notizen/Annotationen
    const userMatchesPromise = searchUserNotesAndAnnotations(query);

    if (!embeddingWorker) {
      const userMatches = await userMatchesPromise;
      set({
        results: [],
        userMatches,
        error: 'Embedding-Worker nicht initialisiert',
        isSearching: false,
      });
      return;
    }

    try {
      console.log(`[SemanticSearchStore] 1. Requesting embedding for query: "${query}"...`);
      // Embedding für die Suchanfrage erzeugen
      const requestId = crypto.randomUUID();
      const embedResponsePromise = sendWorkerMessage(embeddingWorker, {
        type: 'EMBED_SINGLE',
        payload: {
          requestId,
          text: query,
        },
        requestId,
        text: query,
      });

      const [embedResponse, userMatches] = await Promise.all([
        embedResponsePromise,
        userMatchesPromise
      ]);

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

      console.log(`[SemanticSearchStore] 3. Search complete. Found ${results.length} papers, ${userMatches.length} user notes/annotations.`);
      set({ results, userMatches, isSearching: false });
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
    set({ query: '', results: [], userMatches: [], error: null, isSearching: false });
  },

  // -----------------------------------------------------------------------
  // toggleShowUserMatches – Ein/Ausblenden der Notizen & Annotationen
  // -----------------------------------------------------------------------
  toggleShowUserMatches: () => {
    set(state => ({ showUserMatches: !state.showUserMatches }));
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
