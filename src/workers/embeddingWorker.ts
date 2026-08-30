import { pipeline, env } from '@xenova/transformers';

/**
 * Lokale Modellsuche im Dateisystem deaktivieren – Modelle werden remote über Hugging Face geladen
 * und im Browser-Cache (Cache API) zwischengespeichert.
 */
env.allowLocalModels = false;

// ==========================================
// Typdefinitionen für das Worker-Protokoll
// ==========================================

export interface InitPayload {
  modelName: string;
}

export interface EmbedBatchPayload {
  texts: string[];
  requestId: string;
  isQuery?: boolean;
}

export interface EmbedSinglePayload {
  text: string;
  requestId: string;
}

export interface InitProgressPayload {
  status: string;
  progress?: number;
}

export interface InitErrorPayload {
  error: string;
}

export interface EmbedProgressPayload {
  current: number;
  total: number;
  requestId: string;
}

export interface EmbedBatchResultPayload {
  embeddings: number[][];
  requestId: string;
}

export interface EmbedSingleResultPayload {
  embedding: number[];
  requestId: string;
}

export interface EmbedErrorPayload {
  requestId: string;
  error: string;
}

/**
 * Eingehende Nachrichten vom Main-Thread an den Worker.
 */
export type EmbeddingWorkerIncomingMessage =
  | { type: 'INIT'; payload: InitPayload }
  | { type: 'EMBED_BATCH'; payload: EmbedBatchPayload }
  | { type: 'EMBED_SINGLE'; payload: EmbedSinglePayload };

/**
 * Ausgehende Nachrichten vom Worker an den Main-Thread.
 */
export type EmbeddingWorkerOutgoingMessage =
  | { type: 'INIT_SUCCESS' }
  | { type: 'INIT_ERROR'; payload: InitErrorPayload }
  | { type: 'INIT_PROGRESS'; payload: InitProgressPayload }
  | { type: 'EMBED_RESULT'; payload: EmbedBatchResultPayload | EmbedSingleResultPayload }
  | { type: 'EMBED_PROGRESS'; payload: EmbedProgressPayload }
  | { type: 'EMBED_ERROR'; payload: EmbedErrorPayload };

// ==========================================
// Worker State
// ==========================================

let embedder: any = null;
let modelName: string = '';

/**
 * Formatiert den Eingabetext passend zum jeweiligen Modell.
 * BGE-Modelle erfordern das Präfix 'Represent this sentence: '.
 * E5-Modelle (wie multilingual-e5-small) erfordern 'query: ' oder 'passage: '.
 *
 * @param text - Der zu verarbeitende Text
 * @param currentModel - Der Name des aktiven Modells
 * @param isQuery - Ob es sich um eine Suchanfrage handelt (Standard: false = passage)
 * @returns Der entsprechend vorformatierte Text
 */
function formatInputText(text: string, currentModel: string, isQuery: boolean = false): string {
  const modelLower = currentModel.toLowerCase();
  
  if (modelLower.includes('bge') && !text.startsWith('Represent this sentence: ')) {
    return `Represent this sentence: ${text}`;
  }
  
  if (modelLower.includes('e5')) {
    const prefix = isQuery ? 'query: ' : 'passage: ';
    if (!text.startsWith('query: ') && !text.startsWith('passage: ')) {
      return `${prefix}${text}`;
    }
  }
  
  return text;
}

/**
 * Bestimmt die Pooling-Strategie für das Modell.
 * - BGE-Modelle verwenden CLS-Pooling.
 * - E5 (XLM-RoBERTa), MiniLM und die meisten Sentence-Transformer erfordern zwingend MEAN-Pooling.
 */
function getPoolingStrategy(currentModel: string): 'cls' | 'mean' {
  const modelLower = currentModel.toLowerCase();
  if (modelLower.includes('bge')) {
    return 'cls';
  }
  return 'mean';
}

// ==========================================
// Event-Handler für Worker-Nachrichten
// ==========================================

self.onmessage = async (e: MessageEvent<any>) => {
  const data = e.data || {};
  const type = data.type;
  console.log(`[EmbeddingWorker] received message type: ${type}`);
  
  // Unterstützt sowohl geschachtelte payloads ({ payload: { texts } }) als auch flache Nachrichten ({ texts })
  const payload = data.payload || data;

  switch (type) {
    case 'INIT': {
      const targetModel = payload.modelName || payload.model || 'Xenova/bge-small-en-v1.5';
      try {
        // Feature-Extraction Pipeline initialisieren (mit Quantisierung für geringeren Speicherbedarf)
        embedder = await pipeline('feature-extraction', targetModel, {
          quantized: true,
          progress_callback: (progressData: { status?: string; progress?: number; file?: string; loaded?: number; total?: number; [key: string]: any }) => {
            self.postMessage({
              type: 'INIT_PROGRESS',
              payload: {
                status: progressData.status || 'loading',
                file: progressData.file,
                progress: typeof progressData.progress === 'number' ? progressData.progress : undefined,
                loaded: progressData.loaded,
                total: progressData.total,
              },
              status: progressData.status || 'loading',
              file: progressData.file,
              progress: typeof progressData.progress === 'number' ? progressData.progress : undefined,
            });
          },
        });

        modelName = targetModel;

        self.postMessage({
          type: 'INIT_SUCCESS',
          payload: {},
          requestId: payload.requestId || data.requestId,
        });
      } catch (error: any) {
        self.postMessage({
          type: 'INIT_ERROR',
          payload: {
            error: error?.message || 'Fehler beim Laden des Embedding-Modells.',
          },
          error: error?.message || 'Fehler beim Laden des Embedding-Modells.',
          requestId: payload.requestId || data.requestId,
        });
      }
      break;
    }

    case 'EMBED_BATCH': {
      const texts: string[] = payload.texts || [];
      const requestId: string = payload.requestId || data.requestId || '';
      try {
        if (!embedder) {
          throw new Error('Embedding-Modell ist nicht initialisiert. Bitte zuerst INIT aufrufen.');
        }

        const embeddings: number[][] = [];
        const total = texts.length;

        // Sequenzielle Abarbeitung der Texte, da Transformers.js im Browser kein echtes Batching unterstützt
        const pooling = getPoolingStrategy(modelName);
        const isQuery = payload.isQuery === true;
        for (let i = 0; i < total; i++) {
          const formattedText = formatInputText(texts[i], modelName, isQuery); // isQuery = false (Passage/Document)
          const output = await embedder(formattedText, {
            pooling,
            normalize: true,
          });

          // Konvertierung der Tensor-Daten in ein einfaches Number-Array
          const embedding = Array.from(output.data) as number[];
          embeddings.push(embedding);

          self.postMessage({
            type: 'EMBED_PROGRESS',
            payload: {
              current: i + 1,
              total,
              requestId,
            },
            current: i + 1,
            total,
            requestId,
          });
        }

        self.postMessage({
          type: 'EMBED_RESULT',
          payload: {
            embeddings,
            requestId,
          },
          embeddings,
          requestId,
        });
      } catch (error: any) {
        self.postMessage({
          type: 'EMBED_ERROR',
          payload: {
            requestId,
            error: error?.message || 'Fehler bei der Batch-Embedding-Erstellung.',
          },
          error: error?.message || 'Fehler bei der Batch-Embedding-Erstellung.',
          requestId,
        });
      }
      break;
    }

    case 'EMBED_SINGLE': {
      const text: string = payload.text || '';
      const requestId: string = payload.requestId || data.requestId || '';
      try {
        if (!embedder) {
          throw new Error('Embedding-Modell ist nicht initialisiert. Bitte zuerst INIT aufrufen.');
        }

        const formattedText = formatInputText(text, modelName, true); // isQuery = true
        console.log(`[EmbeddingWorker] Starting inference for query: "${text}"`);
        
        const pooling = getPoolingStrategy(modelName);

        // Timeout protection for the WASM inference
        const output = await Promise.race([
          embedder(formattedText, { pooling, normalize: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Inference timeout nach 15 Sekunden')), 15000))
        ]) as any;

        console.log(`[EmbeddingWorker] Inference complete.`);

        // Konvertierung der Tensor-Daten in ein einfaches Number-Array
        const embedding = Array.from(output.data) as number[];

        self.postMessage({
          type: 'EMBED_RESULT',
          payload: {
            embedding,
            requestId,
          },
          embedding,
          requestId,
        });
      } catch (error: any) {
        console.error('[EmbeddingWorker] EMBED_SINGLE error:', error);
        self.postMessage({
          type: 'EMBED_ERROR',
          payload: {
            requestId,
            error: error?.message || 'Fehler bei der Embedding-Erstellung.',
          },
          error: error?.message || 'Fehler bei der Embedding-Erstellung.',
          requestId,
        });
      }
      break;
    }

    default:
      console.warn(`[EmbeddingWorker] Unbekannter Nachrichtentyp: "${type}"`);
      break;
  }
};
