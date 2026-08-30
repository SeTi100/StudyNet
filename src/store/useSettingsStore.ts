import { create } from 'zustand';

export interface SettingsState {
  // LLM Configuration
  geminiApiKey: string;
  geminiModel: string;               // Default: 'gemini-3.6-flash'
  
  // Embedding Configuration
  embeddingModel: string;            // Default: 'Xenova/bge-small-en-v1.5'
  
  // Question Generation
  geminiSystemPrompt: string;        // The prompt template for Gemini
  questionsPerChunk: number;         // Default: 4
  targetChunkSize: number;           // Default: 500 tokens
  deduplicationThreshold: number;    // Default: 0.95
  geminiFallbackModel: string;       // Default: 'gemini-3.5-flash-lite'
  maxRetriesPerModel: number;        // Default: 1 (Versuch 0 + 1 Retry)
  apiTimeoutSeconds: number;         // Default: 60
  
  // Cost tracking pricing customization
  modelPricingOverrides: Record<string, { input: number, output: number }>;
  
  // Docker/Server Embedding (future-proof for dedicated server)
  useRemoteEmbedding: boolean;       // Default: false
  remoteEmbeddingUrl: string;        // Default: 'http://localhost:8000/embed'
  
  // Actions
  setGeminiApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  setEmbeddingModel: (model: string) => void;
  setGeminiSystemPrompt: (prompt: string) => void;
  setQuestionsPerChunk: (n: number) => void;
  setTargetChunkSize: (size: number) => void;
  setDeduplicationThreshold: (t: number) => void;
  setGeminiFallbackModel: (model: string) => void;
  setMaxRetriesPerModel: (retries: number) => void;
  setApiTimeoutSeconds: (seconds: number) => void;
  setModelPricingOverrides: (overrides: Record<string, { input: number, output: number }>) => void;
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
  | 'setGeminiSystemPrompt'
  | 'setQuestionsPerChunk'
  | 'setTargetChunkSize'
  | 'setDeduplicationThreshold'
  | 'setGeminiFallbackModel'
  | 'setMaxRetriesPerModel'
  | 'setApiTimeoutSeconds'
  | 'setModelPricingOverrides'
  | 'setUseRemoteEmbedding'
  | 'setRemoteEmbeddingUrl'
  | 'hasApiKey'
>;

const DEFAULT_SETTINGS: SettingsValues = {
  geminiApiKey: '',
  geminiModel: 'gemini-3.6-flash',
  embeddingModel: 'Xenova/multilingual-e5-small',
  geminiSystemPrompt: `Du bist ein Forschungsingenieur in der Verfahrenstechnik und Materialwissenschaft.
Analysiere den folgenden Textabschnitt und generiere hochspezifische Fragen zur Erweiterung eines Suchindex.

REGELN:
- Verwende niemals Phrasen wie 'in dieser Studie' oder 'laut dem Text'. Die Frage muss für sich allein stehen.
- Erwähne zwingend spezifische Materialien, Reaktionen oder physikalische Parameter, die im Text vorkommen.
- Jede Frage MUSS mit konkreten Details aus dem Text beantwortbar sein.
- KEINE generischen Fragen (z.B. "Worum geht es?", "Was ist das Thema?").
- Ordne jede Frage einer Kategorie zu: method | result | material | conclusion | limitation.
- Schreibe zu jeder Frage eine prägnante 1-2 Satz Kernantwort.

BEISPIEL INPUT TEXT:
"Um die katalytische Aktivität zu testen, wurde ein Cu-Mn-Mischoxid-Katalysator bei verschiedenen Raumgeschwindigkeiten (GHSV) von 15.000 bis 45.000 h⁻¹ für die Ozon-assistierte Oxidation von Toluol bei 80°C eingesetzt. Dabei fiel der Umsatz von Toluol bei einer GHSV von 30.000 h⁻¹ leicht von 100% auf 92% ab."

BEISPIEL ERWARTETER JSON OUTPUT:
{"questions": [
  {
    "question": "Wie verändert sich der Toluol-Umsatz an Cu-Mn-Mischoxid-Katalysatoren bei einer Erhöhung der GHSV auf 30.000 h⁻¹ bei 80°C in Gegenwart von Ozon?",
    "shortAnswer": "Der Umsatz fällt leicht von 100% auf 92% ab.",
    "category": "result"
  }
]}`,
  questionsPerChunk: 4,
  targetChunkSize: 500,
  deduplicationThreshold: 0.95,
  geminiFallbackModel: 'gemini-3.5-flash',
  maxRetriesPerModel: 2, // Standardmäßig 2 Retries
  apiTimeoutSeconds: 60,
  modelPricingOverrides: {},
  useRemoteEmbedding: false,
  remoteEmbeddingUrl: 'http://localhost:8000/embed'
};

/**
 * Loads persisted settings from localStorage with fallback defaults.
 */
export function loadPersistedSettings(): SettingsValues {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      // Automatische Migration des alten 0.88 Schwellenwerts auf 0.95 für e5
      if (parsed.deduplicationThreshold === 0.88) {
        parsed.deduplicationThreshold = 0.95;
      }
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
  setGeminiSystemPrompt: (prompt: string) => set({ geminiSystemPrompt: prompt }),
  setQuestionsPerChunk: (n: number) => set({ questionsPerChunk: n }),
  setTargetChunkSize: (size: number) => set({ targetChunkSize: size }),
  setDeduplicationThreshold: (t: number) => set({ deduplicationThreshold: t }),
  setGeminiFallbackModel: (model: string) => set({ geminiFallbackModel: model }),
  setMaxRetriesPerModel: (retries: number) => set({ maxRetriesPerModel: retries }),
  setApiTimeoutSeconds: (seconds: number) => set({ apiTimeoutSeconds: seconds }),
  setModelPricingOverrides: (overrides: Record<string, { input: number, output: number }>) => set({ modelPricingOverrides: overrides }),
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
