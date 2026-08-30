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

// ---------------------------------------------------------------------------
// Öffentliche Interfaces
// ---------------------------------------------------------------------------

/** Fortschritts-Phasen für die Ingestion-Pipeline */
export interface IngestionProgress {
  phase: 'chunking' | 'generating' | 'deduplicating' | 'embedding' | 'storing' | 'done' | 'error';
  currentChunk?: number;
  totalChunks?: number;
  totalQuestions?: number;
  removedDuplicates?: number;
  error?: string;
}

/** Callback-Typ für Fortschrittsmeldungen */
export type ProgressCallback = (progress: IngestionProgress) => void;

// ---------------------------------------------------------------------------
// Konstanten
// ---------------------------------------------------------------------------

/** Maximale Anzahl an Wiederholungsversuchen bei API-Fehlern */
const MAX_RETRIES = 2;

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
 * 2. Pro Chunk Fragen über Gemini API generieren
 * 3. Alle Fragen via Embedding-Worker vektorisieren
 * 4. Duplikate anhand Kosinus-Ähnlichkeit entfernen
 * 5. Finale Fragen in Dexie persistieren
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
  const { geminiApiKey, geminiModel, questionsPerChunk, deduplicationThreshold } =
    useSettingsStore.getState();

  try {
    // ── Phase 1: Chunking ──────────────────────────────────────────────
    onProgress?.({ phase: 'chunking' });
    const chunks = chunkPageTexts(pageTexts);

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
      onProgress?.({
        phase: 'generating',
        currentChunk: i + 1,
        totalChunks: chunks.length,
      });

      const chunk = chunks[i];
      const generated = await callGeminiForQuestions(
        chunk,
        geminiApiKey,
        geminiModel,
        questionsPerChunk
      );
      
      if (generated.length > 0) {
        console.groupCollapsed(`[Live] Generierte Fragen für Chunk ${i + 1}/${chunks.length}`);
        generated.forEach((q, idx) => {
          console.log(`%cFrage ${idx + 1} (${q.category}):`, 'color: #3b82f6; font-weight: bold;', q.question);
          console.log(`%cAntwort:`, 'color: #10b981;', q.shortAnswer);
        });
        console.groupEnd();
      }

      for (const q of generated) {
        allRawQuestions.push({ ...q, chunk });
      }
    }

    if (allRawQuestions.length === 0) {
      onProgress?.({ phase: 'done', totalQuestions: 0, removedDuplicates: 0 });
      return [];
    }

    // ── Phase 3: Embeddings erzeugen ───────────────────────────────────
    onProgress?.({
      phase: 'embedding',
      totalQuestions: allRawQuestions.length,
    });

    const questionTexts = allRawQuestions.map((q) => q.question);
    const embeddings = await embedQuestionsViaWorker(embeddingWorker, questionTexts);

    // ── Phase 4: Deduplizierung ────────────────────────────────────────
    onProgress?.({
      phase: 'deduplicating',
      totalQuestions: allRawQuestions.length,
    });

    const keepIndices = deduplicateByEmbedding(embeddings, deduplicationThreshold);
    const removedCount = allRawQuestions.length - keepIndices.length;

    // ── Finale Records zusammenbauen ───────────────────────────────────
    const now = new Date();
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
        embedding: embeddings[idx],
        createdAt: now,
      };
    });

    // ── Phase 5: Persistierung ─────────────────────────────────────────
    onProgress?.({
      phase: 'storing',
      totalQuestions: finalRecords.length,
      removedDuplicates: removedCount,
    });

    await db.paperQuestions.bulkPut(finalRecords);

    // ── Fertig ─────────────────────────────────────────────────────────
    onProgress?.({
      phase: 'done',
      totalQuestions: finalRecords.length,
      removedDuplicates: removedCount,
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

/**
 * Ruft die Gemini API auf, um für einen Text-Chunk kategorisierte Fragen zu generieren.
 *
 * Verwendet strukturierte JSON-Ausgabe (`response_mime_type: 'application/json'`).
 * Bei Fehlern wird bis zu MAX_RETRIES mal mit exponentiellem Backoff wiederholt.
 *
 * @param chunk             - Der zu analysierende Text-Chunk
 * @param apiKey            - Gemini API-Schlüssel
 * @param model             - Modellname (z.B. 'gemini-2.0-flash')
 * @param questionsPerChunk - Anzahl der zu generierenden Fragen pro Chunk
 * @returns Array von Fragen mit Kurzantwort und Kategorie
 */
/** Fallback-Modelle bei 503 (High Demand) oder 429 Überlastung */
const FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b'];

/**
 * Sendet einen Text-Chunk an die Gemini REST API und parst die generierten Fragen.
 *
 * Beinhaltet eine automatische Modell-Kaskade:
 * Sollte das gewählte Modell (z.B. gemini-2.5-flash) wegen hoher Serverlast (503/429)
 * überlastet sein, wird nach Retries automatisch auf stabilere Fallback-Modelle gewechselt.
 *
 * @param chunk             - Der zu analysierende Textabschnitt
 * @param apiKey            - Gemini API Key
 * @param model             - Gewünschtes Modell (z.B. 'gemini-1.5-flash')
 * @param questionsPerChunk - Anzahl zu generierender Fragen pro Chunk
 * @returns Array der generierten Frage-Antwort-Paare
 */
async function callGeminiForQuestions(
  chunk: TextChunk,
  apiKey: string,
  model: string,
  questionsPerChunk: number
): Promise<{ question: string; shortAnswer: string; category: QuestionCategory }[]> {
  const primaryModel = (model || 'gemini-1.5-flash').trim().replace(/^models\//, '');
  const candidateModels = [
    primaryModel,
    ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];

  const prompt = buildPrompt(chunk, questionsPerChunk);
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  };

  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Exponentielles Backoff bei Wiederholungsversuchen
        if (attempt > 0) {
          const delayMs = Math.pow(2, attempt) * 1000 + Math.random() * 500; // 2s..4.5s
          await sleep(delayMs);
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        // 503 (High Demand / Service Unavailable) oder 429 (Rate Limit) → retry / fallback
        if (response.status === 503 || response.status === 429 || response.status >= 500) {
          const errData = await response.json().catch(() => null);
          const errMsg = errData?.error?.message || response.statusText;
          lastError = new Error(`Gemini API HTTP ${response.status} (${currentModel}): ${errMsg}`);
          console.warn(`[questionGenerationService] ${currentModel} überlastet (${response.status}), retry/fallback...`);
          continue;
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          const errMsg = errData?.error?.message || `HTTP ${response.status} ${response.statusText}`;
          throw new Error(`Gemini API Fehler (${currentModel}): ${errMsg}`);
        }

        const data = await response.json();
        const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof textContent !== 'string') {
          lastError = new Error('Ungültige Gemini API Antwort: kein Textinhalt');
          continue;
        }

        return parseGeminiResponse(textContent);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (
          lastError.message.includes('not found') ||
          lastError.message.includes('404') ||
          lastError.message.includes('API_KEY_INVALID')
        ) {
          break; // Bei 404 direkt zum nächsten Fallback-Modell
        }

        if (attempt === MAX_RETRIES) break;
      }
    }
  }

  // Nach allen Versuchen & Modellen gescheitert → leeres Array statt Abbruch
  console.error(
    `[questionGenerationService] Chunk "${chunk.chunkId}" fehlgeschlagen nach allen Retries & Modellen:`,
    lastError
  );
  return [];
}

/**
 * Baut den Prompt für die Gemini API zusammen.
 */
function buildPrompt(chunk: TextChunk, questionsPerChunk: number): string {
  const sectionLine = chunk.sectionHeader ? `Abschnitt: ${chunk.sectionHeader}` : '';

  return `Du bist ein wissenschaftlicher Fragen-Extraktor für Fachpublikationen.

Analysiere den folgenden Textabschnitt aus einem wissenschaftlichen Paper und generiere genau ${questionsPerChunk} hochspezifische Fragen.

REGELN:
- Jede Frage MUSS mit konkreten Details aus dem Text beantwortbar sein
- KEINE generischen Fragen (z.B. "Worum geht es?", "Was ist das Thema?")
- Fragen sollen extrahierend sein: Methoden, Messwerte, Materialien, Konzentrationen, Temperaturen, etc.
- Jede Frage bekommt eine Kategorie: method | result | material | conclusion | limitation
- Jede Frage bekommt eine prägnante 1-2 Satz Kernantwort, die direkt aus dem Text ableitbar ist
- Wenn der Textabschnitt zu kurz oder uninformativ ist, generiere weniger Fragen und setze die Kategorie auf 'general'

${sectionLine}

TEXTABSCHNITT:
"""${chunk.text}"""

Antworte NUR mit einem JSON-Objekt in diesem Format:
{"questions": [{"question": "...", "shortAnswer": "...", "category": "method|result|material|conclusion|limitation|general"}]}`;
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

    // WICHTIG: Payload korrekt geschachtelt übergeben
    worker.postMessage({
      type: 'EMBED_BATCH',
      payload: {
        requestId,
        texts,
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
 * @param embeddings - Embedding-Vektoren aller Fragen
 * @param threshold  - Ähnlichkeitsschwelle (z.B. 0.88)
 * @returns Indizes der zu behaltenden Fragen
 */
function deduplicateByEmbedding(embeddings: number[][], threshold: number): number[] {
  const keepIndices: number[] = [];

  for (let i = 0; i < embeddings.length; i++) {
    let isDuplicate = false;

    for (const keptIdx of keepIndices) {
      const similarity = cosineSimilarity(embeddings[i], embeddings[keptIdx]);
      if (similarity > threshold) {
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

