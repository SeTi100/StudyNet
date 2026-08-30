import { create } from 'zustand';

export interface SettingsState {
  // LLM Configuration
  geminiApiKey: string;
  geminiModel: string;               // Default: 'gemini-2.0-flash'
  
  // Embedding Configuration
  embeddingModel: string;            // Default: 'Xenova/bge-small-en-v1.5'
  
  // Question Generation
  questionsPerChunk: number;         // Default: 4
  deduplicationThreshold: number;    // Default: 0.88
  
  // Docker/Server Embedding (future-proof for dedicated server)
  useRemoteEmbedding: boolean;       // Default: false
  remoteEmbeddingUrl: string;        // Default: 'http://localhost:8000/embed'
  
  // Actions
  setGeminiApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setQuestionsPerChunk: (n: number) => void;
  setDeduplicationThreshold: (t: number) => void;
  setUseRemoteEmbedding: (use: boolean) => void;
  setRemoteEmbeddingUrl: (url: string) => void;
  hasApiKey: () => boolean;
}

const STORAGE_KEY = 'studynet_settings';

type SettingsValues = Omit<
  SettingsState,
  | 'setGeminiApiKey'
  | 'setGeminiModel'
  | 'setEmbeddingModel'
  | 'setQuestionsPerChunk'
  | 'setDeduplicationThreshold'
  | 'setUseRemoteEmbedding'
  | 'setRemoteEmbeddingUrl'
  | 'hasApiKey'
>;

const DEFAULT_SETTINGS: SettingsValues = {
  geminiApiKey: '',
  geminiModel: 'gemini-1.5-flash',
  embeddingModel: 'Xenova/bge-small-en-v1.5',
  questionsPerChunk: 4,
  deduplicationThreshold: 0.88,
  useRemoteEmbedding: false,
  remoteEmbeddingUrl: 'http://localhost:8000/embed',
};

/**
 * Loads persisted settings from localStorage with fallback defaults.
 */
export function loadPersistedSettings(): SettingsValues {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
      };
    }
  } catch (error) {
    console.error('Failed to load settings from localStorage:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

const initialSettings = loadPersistedSettings();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initialSettings,

  setGeminiApiKey: (key: string) => set({ geminiApiKey: key }),
  setGeminiModel: (model: string) => set({ geminiModel: model }),
  setEmbeddingModel: (model: string) => set({ embeddingModel: model }),
  setQuestionsPerChunk: (n: number) => set({ questionsPerChunk: n }),
  setDeduplicationThreshold: (t: number) => set({ deduplicationThreshold: t }),
  setUseRemoteEmbedding: (use: boolean) => set({ useRemoteEmbedding: use }),
  setRemoteEmbeddingUrl: (url: string) => set({ remoteEmbeddingUrl: url }),
  hasApiKey: () => get().geminiApiKey.trim().length > 0,
}));

// Subscribe to store changes to auto-persist settings in localStorage
if (typeof window !== 'undefined') {
  useSettingsStore.subscribe((state) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('Failed to persist settings to localStorage:', error);
    }
  });
}
