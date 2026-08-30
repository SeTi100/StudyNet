/**
 * questionGenerationService.ts
 *
 * Kern-Service für die Fragen-Generierung aus wissenschaftlichen PDFs.
 * Orchestriert: Chunking → Gemini API → Deduplizierung → Embedding → Persistierung.
 */

import { db, type GeneratedQuestionRecord, type QuestionCategory } from '../db/schema';
import { chunkPageTexts, type TextChunk } from '../utils/chunker';
import { cosineSimilarity } from '../utils/vectorMath';
import { useSettingsStore } from '../store/useSettingsStore';
import { calculateEstimatedCostUsd } from '../utils/tokenCostCalculator';

// ---------------------------------------------------------------------------
// Öffentliche Interfaces
// ---------------------------------------------------------------------------

/** Detaillierte Token-Statistiken für die Analyse */
export interface TokenStats {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  model: string;
}

/** Fortschritts-Phasen für die Ingestion-Pipeline */
export interface IngestionProgress {
  phase: 'chunking' | 'generating' | 'deduplicating' | 'embedding' | 'storing' | 'done' | 'error';
  currentChunk?: number;
  totalChunks?: number;
  totalQuestions?: number;
  removedDuplicates?: number;
  tokenStats?: TokenStats;
  error?: string;
}

/** Callback-Typ für Fortschrittsmeldungen */
export type ProgressCallback = (progress: IngestionProgress) => void;

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------


/** Gültige Kategorien für generierte Fragen */
const VALID_CATEGORIES: ReadonlySet<QuestionCategory> = new Set([
  'method',
  'result',
  'material',
  'conclusion',
  'limitation',
  'general',
]);

// ---------------------------------------------------------------------------
// Haupt-Export: generateQuestionsForDocument
// ---------------------------------------------------------------------------

/**
 * Generiert Fragen für ein Dokument anhand der extrahierten Seitentexte.
 *
 * Pipeline:
 * 1. Text in Chunks aufteilen
 * 2. Pro Chunk Fragen über Gemini API generieren + Token-Zähler aktualisieren
 * 3. Alle Fragen via Embedding-Worker vektorisieren
 * 4. Duplikate anhand Kosinus-Ähnlichkeit entfernen
 * 5. Finale Fragen & Token-Nutzung in Dexie persistieren
 *
 * @param documentId   - ID des zugehörigen Dokuments
 * @param pageTexts    - Seitentexte aus dem pdfProcessor-Worker (Seitennummer → Text)
 * @param embeddingWorker - Referenz auf den aktiven Embedding-Web-Worker
 * @param onProgress   - Optionaler Callback für Fortschrittsmeldungen
 * @returns Array der gespeicherten GeneratedQuestionRecords
 */
export async function generateQuestionsForDocument(
  documentId: string,
  pageTexts: Record<number, string>,
  embeddingWorker: Worker,
  onProgress?: ProgressCallback
): Promise<GeneratedQuestionRecord[]> {
  const {
    geminiApiKey,
    geminiModel,
    geminiSystemPrompt,
    questionsPerChunk,
    deduplicationThreshold,
    targetChunkSize,
    geminiFallbackModel,
    maxRetriesPerModel,
  } = useSettingsStore.getState();

  let cumulativePromptTokens = 0;
  let cumulativeOutputTokens = 0;
  let cumulativeTotalTokens = 0;
  let lastModelUsed = (geminiModel || 'gemini-3.7-flash').trim().replace(/^models\//, '');

  try {
    // ── Phase 1: Chunking ──────────────────────────────────────────────
    onProgress?.({ phase: 'chunking' });
    const targetTokens = targetChunkSize || 500;
    const maxTokens = Math.round(targetTokens * 1.6);
    const chunks = chunkPageTexts(pageTexts, { targetTokens, maxTokens });

    if (chunks.length === 0) {
      onProgress?.({ phase: 'done', totalQuestions: 0, removedDuplicates: 0 });
      return [];
    }

    // ── Phase 2: Fragen generieren ─────────────────────────────────────
    const allRawQuestions: {
      question: string;
      shortAnswer: string;
      category: QuestionCategory;
      chunk: TextChunk;
    }[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = await callGeminiForQuestions(
        chunk,
        geminiApiKey,
        geminiModel,
        geminiFallbackModel,
        maxRetriesPerModel,
        geminiSystemPrompt,
        questionsPerChunk
      );

      cumulativePromptTokens += result.usage.promptTokens;
      cumulativeOutputTokens += result.usage.outputTokens;
      cumulativeTotalTokens += result.usage.totalTokens;
      lastModelUsed = result.modelUsed;

      const estimatedCost = calculateEstimatedCostUsd(
        lastModelUsed,
        cumulativeTotalTokens,
        cumulativeOutputTokens
      );

      const currentStats: TokenStats = {
        promptTokens: cumulativePromptTokens,
        outputTokens: cumulativeOutputTokens,
        totalTokens: cumulativeTotalTokens,
        estimatedCostUsd: estimatedCost,
        model: lastModelUsed,
      };

      onProgress?.({
        phase: 'generating',
        currentChunk: i + 1,
        totalChunks: chunks.length,
        tokenStats: currentStats,
      });
      
      if (result.questions.length > 0) {
        console.groupCollapsed(
          `[Live] Generierte Fragen für Chunk ${i + 1}/${chunks.length} (${result.usage.totalTokens} Tokens)`
        );
        result.questions.forEach((q, idx) => {
          console.log(`%cFrage ${idx + 1} (${q.category}):`, 'color: #3b82f6; font-weight: bold;', q.question);
          console.log(`%cAntwort:`, 'color: #10b981;', q.shortAnswer);
        });
        console.groupEnd();
      }

      for (const q of result.questions) {
        allRawQuestions.push({ ...q, chunk });
      }
    }

    const finalTokenStats: TokenStats = {
      promptTokens: cumulativePromptTokens,
      outputTokens: cumulativeOutputTokens,
      totalTokens: cumulativeTotalTokens,
      estimatedCostUsd: calculateEstimatedCostUsd(
        lastModelUsed,
        cumulativeTotalTokens,
        cumulativeOutputTokens
      ),
      model: lastModelUsed,
    };

    if (allRawQuestions.length === 0) {
      // Speichere Token-Nutzung auch wenn keine Fragen extrahiert wurden
      await db.documents.update(documentId, { tokenUsage: finalTokenStats });
      onProgress?.({ phase: 'done', totalQuestions: 0, removedDuplicates: 0, tokenStats: finalTokenStats });
      return [];
    }

    // ── Phase 3: Embeddings erzeugen (Chunks + Fragen) ─────────────────
    onProgress?.({
      phase: 'embedding',
      totalQuestions: allRawQuestions.length + chunks.length,
      tokenStats: finalTokenStats,
    });

    const chunkTexts = chunks.map((c) => c.text);
    const questionTexts = allRawQuestions.map((q) => q.question);

    // Chunks und Fragen vektorisieren
    const [chunkEmbeddings, questionEmbeddings] = await Promise.all([
      embedQuestionsViaWorker(embeddingWorker, chunkTexts),
      embedQuestionsViaWorker(embeddingWorker, questionTexts),
    ]);

    // ── Phase 4: Deduplizierung (NUR für Fragen) ────────────────────────
    onProgress?.({
      phase: 'deduplicating',
      totalQuestions: allRawQuestions.length,
    });

    const keepIndices = deduplicateByEmbedding(
      allRawQuestions.map((q) => q.question),
      questionEmbeddings,
      deduplicationThreshold
    );
    const removedCount = allRawQuestions.length - keepIndices.length;
    console.log(
      `[Deduplizierung] ${keepIndices.length} von ${allRawQuestions.length} Fragen behalten (${removedCount} Duplikate entfernt bei Threshold ${deduplicationThreshold})`
    );

    // ── Finale Records zusammenbauen ───────────────────────────────────
    const now = new Date();
    
    // Rohe Chunks MIT Embeddings speichern (Multi-Vector Retrieval)
    const chunkRecords = chunks.map((chunk, index) => ({
      id: crypto.randomUUID(),
      documentId,
      chunkId: chunk.chunkId,
      text: chunk.text,
      pageNumber: chunk.pageNumber,
      sequenceIndex: index,
      embedding: chunkEmbeddings[index],
      createdAt: now,
    }));

    const finalRecords: GeneratedQuestionRecord[] = keepIndices.map((idx) => {
      const raw = allRawQuestions[idx];
      return {
        id: crypto.randomUUID(),
        documentId,
        question: raw.question,
        shortAnswer: raw.shortAnswer,
        category: raw.category,
        chunkId: raw.chunk.chunkId,
        chunkText: raw.chunk.text,
        pageNumber: raw.chunk.pageNumber,
        embedding: questionEmbeddings[idx],
        createdAt: now,
      };
    });

    // ── Phase 5: Persistierung ─────────────────────────────────────────
    onProgress?.({
      phase: 'storing',
      totalQuestions: finalRecords.length,
      removedDuplicates: removedCount,
      tokenStats: finalTokenStats,
    });

    await db.transaction('rw', db.paperQuestions, db.documentChunks, db.documents, async () => {
      await db.documentChunks.bulkPut(chunkRecords);
      await db.paperQuestions.bulkPut(finalRecords);
      await db.documents.update(documentId, { tokenUsage: finalTokenStats });
    });

    // ── Fertig ─────────────────────────────────────────────────────────
    onProgress?.({
      phase: 'done',
      totalQuestions: finalRecords.length,
      removedDuplicates: removedCount,
      tokenStats: finalTokenStats,
    });

    return finalRecords;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    onProgress?.({ phase: 'error', error: errorMessage });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Interne Helfer
// ---------------------------------------------------------------------------


interface GeminiCallResult {
  questions: { question: string; shortAnswer: string; category: QuestionCategory }[];
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
  modelUsed: string;
}

/**
 * Sendet einen Text-Chunk an die Gemini REST API und parst die generierten Fragen samt Token-Verbrauch.
 *
 * Beinhaltet eine automatische Modell-Kaskade:
 * Sollte das gewählte Modell (z.B. gemini-2.5-flash) wegen hoher Serverlast (503/429)
 * überlastet sein, wird nach Retries automatisch auf stabilere Fallback-Modelle gewechselt.
 *
 * @param chunk             - Der zu analysierende Textabschnitt
 * @param apiKey            - Gemini API Key
 * @param model             - Gewünschtes Modell (z.B. 'gemini-1.5-flash')
 * @param questionsPerChunk - Anzahl zu generierender Fragen pro Chunk
 * @returns Array der generierten Frage-Antwort-Paare mit Token-Statistiken
 */
async function callGeminiForQuestions(
  chunk: TextChunk,
  apiKey: string,
  model: string,
  fallbackModel: string,
  maxRetries: number,
  systemPrompt: string,
  questionsPerChunk: number
): Promise<GeminiCallResult> {
  const primaryModel = (model || 'gemini-3.7-flash').trim().replace(/^models\//, '');
  const secondaryModel = (fallbackModel || 'gemini-3.5-flash').trim().replace(/^models\//, '');
  
  const { apiTimeoutSeconds = 60 } = useSettingsStore.getState();
  const timeoutMs = apiTimeoutSeconds * 1000;
  
  // Modelle aus den Einstellungen dynamisch nutzen (Primär + Fallback)
  const candidateModels = Array.from(
    new Set([primaryModel, secondaryModel].filter(Boolean))
  );

  const prompt = buildPrompt(chunk, systemPrompt, questionsPerChunk);
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                question: { type: 'STRING' },
                shortAnswer: { type: 'STRING' },
                category: {
                  type: 'STRING',
                  enum: ['method', 'result', 'material', 'conclusion', 'limitation', 'general']
                }
              },
              required: ['question', 'shortAnswer', 'category']
            }
          }
        },
        required: ['questions']
      }
    },
  };

  let lastError: Error | null = null;
  let totalAttemptsCount = 0; // Für Hard Cap Kontrolle (obwohl wir logisch schon gecappt sind)

  console.log(`[Gemini Debug] Start processing Chunk ${chunk.chunkId} | Primary: ${primaryModel} | Fallback: ${secondaryModel} | Timeout: ${apiTimeoutSeconds}s`);

  for (const currentModel of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

    // Anzahl Retries aus den Einstellungen nutzen
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      totalAttemptsCount++;
      try {
        // Fast-Polling-Logik: 400ms Base Delay + 0-600ms Jitter
        if (totalAttemptsCount > 1) {
          const delayMs = 400 + Math.random() * 600;
          console.log(`[Gemini Debug] ⏳ Waiting ${delayMs.toFixed(0)}ms before retry...`);
          await sleep(delayMs);
        }

        console.log(`[Gemini Debug] 🚀 API Call | Model: ${currentModel} | Attempt: ${attempt + 1}/${maxRetries + 1} | Chunk: ${chunk.chunkId}`);

        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => {
          controller.abort(new Error(`Timeout: Gemini API hat nach ${apiTimeoutSeconds}s nicht geantwortet`));
        }, timeoutMs);

        let response: Response;
        const startTime = Date.now();
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutTimer);
        }

        const duration = Date.now() - startTime;
        console.log(`[Gemini Debug] 📥 Response received | HTTP ${response.status} | Duration: ${duration}ms`);

        // 503 (High Demand / Service Unavailable) oder 429 (Rate Limit) → retry / fallback
        if (response.status === 503 || response.status === 429 || response.status >= 500) {
          const errData = await response.json().catch(() => null);
          const errMsg = errData?.error?.message || response.statusText;
          lastError = new Error(`Gemini API HTTP ${response.status} (${currentModel}): ${errMsg}`);
          console.warn(`[Gemini Debug] ⚠️ Model ${currentModel} overloaded (HTTP ${response.status}). Retrying... Msg: ${errMsg}`);
          continue;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          const errMsg = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
          console.error(`[Gemini Debug] ❌ HTTP Error | Msg: ${errMsg}`);
          throw new Error(`Gemini API Fehler (${currentModel}): ${errMsg}`);
        }

        const data = await response.json();
        const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof textContent !== 'string') {
          lastError = new Error('Ungültige Gemini API Antwort: kein Textinhalt');
          console.warn(`[Gemini Debug] ⚠️ Invalid response structure (no text part).`);
          continue;
        }

        const promptTokens = data?.usageMetadata?.promptTokenCount || 0;
        const outputTokens = data?.usageMetadata?.candidatesTokenCount || 0;
        const totalTokens = data?.usageMetadata?.totalTokenCount || (promptTokens + outputTokens);

        console.log(`[Gemini Debug] ✅ Success! | Model: ${currentModel} | Tokens: ${promptTokens} In + ${outputTokens} Out = ${totalTokens} Total`);

        return {
          questions: parseGeminiResponse(textContent),
          usage: { promptTokens, outputTokens, totalTokens },
          modelUsed: currentModel,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        console.warn(`[Gemini Debug] ❌ Attempt ${attempt + 1} failed | Model: ${currentModel} | Error: ${lastError.message}`);

        if (
          lastError.message.includes('not found') ||
          lastError.message.includes('404') ||
          lastError.message.includes('API_KEY_INVALID')
        ) {
          console.warn(`[Gemini Debug] 🔄 Fatal error (404 / Invalid Key). Switching to Fallback immediately...`);
          break; // Bei 404 direkt zum nächsten Fallback-Modell
        }

        if (attempt === maxRetries) {
          console.warn(`[Gemini Debug] ⚠️ Max retries (${maxRetries}) reached for ${currentModel}.`);
          break;
        }
      }
    }
  }

  // Nach allen Versuchen & Modellen gescheitert → harter Abbruch
  console.error(
    `[Gemini Debug] 💥 Chunk "${chunk.chunkId}" fehlgeschlagen nach allen Retries & Modellen! Letzter Fehler:`,
    lastError
  );
  throw lastError || new Error('API Request fehlgeschlagen nach allen Retries');
}

/**
 * Baut den Prompt für die Gemini API zusammen.
 */
function buildPrompt(chunk: TextChunk, systemPrompt: string, questionsPerChunk: number): string {
  const sectionLine = chunk.sectionHeader ? `Abschnitt: ${chunk.sectionHeader}` : '';

  return `${systemPrompt}

Bitte generiere genau ${questionsPerChunk} Fragen basierend auf diesem Text:

${sectionLine}

TEXTABSCHNITT:
"""${chunk.text}"""`;
}

/**
 * Parst die JSON-Antwort der Gemini API und validiert die Kategorien.
 *
 * @param raw - Roher JSON-String aus der API-Antwort
 * @returns Validiertes Array von Fragen
 */
function parseGeminiResponse(
  raw: string
): { question: string; shortAnswer: string; category: QuestionCategory }[] {
  try {
    let cleaned = raw.trim();
    // Markdown-Code-Fences entfernen (```json ... ```)
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    const questions: { question: string; shortAnswer: string; category: QuestionCategory }[] = [];

    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
      console.warn('[questionGenerationService] Unerwartetes JSON-Format:', raw.slice(0, 200));
      return [];
    }

    for (const item of parsed.questions) {
      if (
        typeof item.question !== 'string' ||
        typeof item.shortAnswer !== 'string' ||
        !item.question.trim() ||
        !item.shortAnswer.trim()
      ) {
        continue;
      }

      // Kategorie validieren – Fallback auf 'general'
      const category: QuestionCategory = VALID_CATEGORIES.has(item.category)
        ? item.category
        : 'general';

      questions.push({
        question: item.question.trim(),
        shortAnswer: item.shortAnswer.trim(),
        category,
      });
    }

    return questions;
  } catch (err) {
    console.error('[questionGenerationService] JSON-Parsing fehlgeschlagen:', err);
    return [];
  }
}

/**
 * Sendet Texte an den Embedding-Worker und wartet auf die resultierenden Vektoren.
 *
 * Kommunikation über `postMessage` mit eindeutiger `requestId`,
 * um Request und Response korrekt zuzuordnen.
 *
 * @param worker - Referenz auf den Embedding-Web-Worker
 * @param texts  - Zu einbettende Texte
 * @returns 2D-Array der Embedding-Vektoren (ein Vektor pro Text)
 */
function embedQuestionsViaWorker(worker: Worker, texts: string[]): Promise<number[][]> {
  return new Promise<number[][]>((resolve, reject) => {
    const requestId = crypto.randomUUID();

    /** Handler für Worker-Antworten */
    const onMessage = (event: MessageEvent) => {
      const data = event.data;

      if (
        data?.type === 'EMBED_RESULT' &&
        (data.requestId === requestId || data.payload?.requestId === requestId)
      ) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        const embeddings = (data.payload?.embeddings || data.embeddings) as number[][];
        resolve(embeddings);
      } else if (
        data?.type === 'EMBED_ERROR' &&
        (data.requestId === requestId || data.payload?.requestId === requestId)
      ) {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(data.payload?.error || data.error || 'Embedding-Fehler'));
      }
    };

    /** Handler für Worker-Fehler */
    const onError = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      reject(new Error(`Embedding-Worker Fehler: ${event.message}`));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    // WICHTIG: Payload korrekt geschachtelt übergeben (isQuery: false für passage: Präfix bei e5)
    worker.postMessage({
      type: 'EMBED_BATCH',
      payload: {
        requestId,
        texts,
        isQuery: false,
      },
    });
  });
}

/**
 * Dedupliziert Fragen anhand ihrer Embedding-Vektoren.
 *
 * Geht sequenziell durch alle Fragen und behält nur solche,
 * deren Kosinus-Ähnlichkeit zu allen bereits behaltenen Fragen
 * unter dem Schwellenwert liegt.
 *
 * @param questions  - Fragetexte zur Protokollierung
 * @param embeddings - Embedding-Vektoren aller Fragen
 * @param threshold  - Ähnlichkeitsschwelle (z.B. 0.95)
 * @returns Indizes der zu behaltenden Fragen
 */
function deduplicateByEmbedding(
  questions: string[],
  embeddings: number[][],
  threshold: number
): number[] {
  const keepIndices: number[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    let isDuplicate = false;

    for (const keptIdx of keepIndices) {
      const similarity = cosineSimilarity(embeddings[i], embeddings[keptIdx]);
      if (similarity > threshold) {
        console.log(
          `[Deduplizierung] Frage ${i + 1} ("${questions[i]}") entfernt als Duplikat von Frage ${keptIdx + 1} ("${questions[keptIdx]}") mit Ähnlichkeit ${(similarity * 100).toFixed(1)}% (Threshold: ${(threshold * 100).toFixed(1)}%)`
        );
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      keepIndices.push(i);
    }
  }

  return keepIndices;
}

/**
 * Hilfsfunktion für verzögertes Warten (exponentielles Backoff).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

