/**
 * @file hybridSearchEngine.ts
 * Kern-Suchmaschine: Kombiniert dichte Vektorsuche (Cosine Similarity)
 * mit dünnbesetzter BM25-Schlüsselwortsuche (MiniSearch) über Reciprocal Rank Fusion (RRF).
 * Durchsucht Rohtext-Chunks (Parent) und generierte Fragen (Child) gemeinsam
 * und aggregiert Ergebnisse via Max-Pooling auf Parent-Chunk- und Paper-Ebene.
 */

import MiniSearch from 'minisearch';
import { db } from '../db/schema';
import type {
  DocumentRecord,
  DocumentChunkRecord,
  GeneratedQuestionRecord,
  QuestionCategory,
} from '../db/schema';
import { cosineSimilarity } from '../utils/vectorMath';
import { normalizeLigaturesAndFontArtifacts } from '../utils/textNormalization';

// ─── Exportierte Typen ──────────────────────────────────────────────────────────

/** Relevanz-Badge für die visuelle Darstellung im UI */
export type RelevanceBadge = 'high' | 'related';

/**
 * Roh-Treffer aus dem Vector Search Worker (ohne Text-Payload für minimalen Speicherverbrauch).
 */
export interface RawVectorHit {
  id: string;                    // UUID des Chunks oder der Frage
  chunkId: string;               // Semantische Chunk-ID (z. B. "chunk_p4_0")
  documentId: string;
  score: number;                 // Kosinus-Ähnlichkeit [0, 1]
  type: 'chunk' | 'question';
  pageNumber: number;            // Seitenzahl im PDF
  category?: QuestionCategory;   // Optionale Kategorie (bei Fragen)
}

/**
 * Roh-Treffer aus der MiniSearch BM25-Suche.
 */
export interface RawKeywordHit {
  id: string;                    // Eindeutige ID im MiniSearch Index ("c_UUID" oder "q_UUID")
  chunkId: string;               // Semantische Chunk-ID
  documentId: string;
  score: number;                 // BM25-Score aus MiniSearch
  type: 'chunk' | 'question';
  text: string;
  pageNumber: number;
  category?: QuestionCategory;
}

/**
 * Nach chunkId aggregiertes Vektor-Suchergebnis (Max-Pooling).
 */
export interface PooledChunkResult {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  maxScore: number;              // Höchster Vektor-Score (aus Chunk ODER Fragen)
  parentChunkText: string;       // Rohtext des Parent-Chunks (asynchron via Dexie hydriert)
  triggerQuestion?: {            // Frage, die den höchsten Score geliefert hat (optional)
    text: string;
    score: number;
    category?: QuestionCategory;
  };
}

/**
 * Nach chunkId aggregiertes Keyword-Suchergebnis (Max-Pooling).
 */
export interface KeywordChunkResult {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  score: number;                 // Höchster BM25-Score
  text: string;                  // Rohtext des Parent-Chunks
  triggerQuestion?: {
    text: string;
    score: number;
    category?: QuestionCategory;
  };
}

/**
 * Finales hybrides Einzelergebnis nach Reciprocal Rank Fusion (RRF).
 */
export interface HybridRRFResult {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  parentChunkText: string;
  rrfScore: number;
  vectorScore: number;
  keywordScore: number;
  rankVector: number;
  rankKeyword: number;
  triggerQuestion?: {
    text: string;
    score: number;
    category?: QuestionCategory;
  };
}

/**
 * Repräsentiert einen gematchten Chunk innerhalb eines Papers für die UI.
 */
export interface MatchedChunk {
  chunkId: string;
  documentId: string;
  pageNumber: number;
  parentChunkText: string;
  rrfScore: number;
  vectorScore: number;
  keywordScore: number;
  rankVector: number;
  rankKeyword: number;
  triggerQuestion?: {
    text: string;
    score: number;
    category?: QuestionCategory;
  };
}

/**
 * Aggregiertes Suchergebnis auf Paper-Ebene.
 */
export interface PaperSearchResult {
  documentId: string;
  document: DocumentRecord;
  paperScore: number;
  relevanceBadge: RelevanceBadge;
  matchedChunks: MatchedChunk[];
}

/** Suchoptionen zur Steuerung der Hybrid-Suche */
export interface SearchOptions {
  topK?: number;
  maxPapers?: number;
  categoryFilter?: QuestionCategory[];
  vectorWeight?: number;
  bm25Weight?: number;
  hardFloorScore?: number;
}

// ─── Interne Hilfstypen & Konstanten ───────────────────────────────────────────

interface MiniSearchDoc {
  id: string;                    // Global eindeutige ID (z.B. "c_${id}" / "q_${id}")
  chunkId: string;
  documentId: string;
  type: 'chunk' | 'question';
  text: string;
  pageNumber: number;
  category?: QuestionCategory;
}

/** RRF-Konstante k – Standard-Wert aus der Literatur (Cormack et al.) */
const RRF_K = 60;

/** Gewichtungen für die Multi-Match-Aggregation der Top-3 Chunks pro Paper */
const MULTI_MATCH_WEIGHTS = [1.0, 0.5, 0.25];

// ─── Max-Pooling & Fusion Funktionen ───────────────────────────────────────────

/**
 * Max-Pooling für Vektor-Treffer:
 * Gruppiert flache Treffer aus dem Worker nach `chunkId`.
 * Ermittelt den maximalen Score (aus Chunk oder zugehörigen Fragen)
 * und hydriert fehlenden Rohtext asynchron via Dexie (`chunkId`).
 */
export async function aggregateMaxPooling(
  rawHits: RawVectorHit[],
  scoreThreshold: number = 0.5,
  questionsMap?: Map<string, string>
): Promise<PooledChunkResult[]> {
  const chunkMap = new Map<string, PooledChunkResult>();

  for (const hit of rawHits) {
    if (hit.score < scoreThreshold) continue;

    if (!chunkMap.has(hit.chunkId)) {
      chunkMap.set(hit.chunkId, {
        chunkId: hit.chunkId,
        documentId: hit.documentId,
        pageNumber: hit.pageNumber,
        maxScore: hit.score,
        parentChunkText: '', // Wird via Dexie Hydration gefüllt
        triggerQuestion:
          hit.type === 'question'
            ? {
                text: questionsMap?.get(hit.id) || '',
                score: hit.score,
                category: hit.category,
              }
            : undefined,
      });
    } else {
      const existing = chunkMap.get(hit.chunkId)!;

      if (hit.score > existing.maxScore) {
        existing.maxScore = hit.score;
      }

      if (hit.type === 'question') {
        if (!existing.triggerQuestion || hit.score > existing.triggerQuestion.score) {
          existing.triggerQuestion = {
            text: questionsMap?.get(hit.id) || '',
            score: hit.score,
            category: hit.category,
          };
        }
      }
    }
  }

  const pooledResults = Array.from(chunkMap.values());

  // Hydration fehlender Rohtexte via chunkId
  const missingChunkIds = pooledResults.map((r) => r.chunkId);
  if (missingChunkIds.length > 0) {
    const missingChunksFromDB = await db.documentChunks
      .where('chunkId')
      .anyOf(missingChunkIds)
      .toArray();

    const dbChunkMap = new Map(missingChunksFromDB.map((c) => [c.chunkId, c]));

    for (const result of pooledResults) {
      const found = dbChunkMap.get(result.chunkId);
      if (found) {
        result.parentChunkText = found.text;
        result.pageNumber = found.pageNumber;
      } else if (!result.parentChunkText) {
        result.parentChunkText = '[Rohtext nicht gefunden]';
      }
    }
  }

  return pooledResults.sort((a, b) => b.maxScore - a.maxScore);
}

/**
 * Max-Pooling für Keyword-Treffer (MiniSearch BM25):
 * Gruppiert Treffer nach `chunkId`, übernimmt den höchsten Score
 * und hydriert fehlenden Rohtext via Dexie (`chunkId`).
 */
export async function aggregateKeywordHits(
  rawHits: RawKeywordHit[],
  questionsMap?: Map<string, string>
): Promise<KeywordChunkResult[]> {
  const chunkMap = new Map<string, KeywordChunkResult>();

  for (const hit of rawHits) {
    if (!chunkMap.has(hit.chunkId)) {
      chunkMap.set(hit.chunkId, {
        chunkId: hit.chunkId,
        documentId: hit.documentId,
        pageNumber: hit.pageNumber,
        score: hit.score,
        text: hit.type === 'chunk' ? hit.text : '',
        triggerQuestion:
          hit.type === 'question'
            ? {
                text: questionsMap?.get(hit.id) || hit.text,
                score: hit.score,
                category: hit.category,
              }
            : undefined,
      });
    } else {
      const existing = chunkMap.get(hit.chunkId)!;

      if (hit.score > existing.score) {
        existing.score = hit.score;
      }

      if (hit.type === 'chunk' && !existing.text) {
        existing.text = hit.text;
      }

      if (hit.type === 'question') {
        if (!existing.triggerQuestion || hit.score > existing.triggerQuestion.score) {
          existing.triggerQuestion = {
            text: questionsMap?.get(hit.id) || hit.text,
            score: hit.score,
            category: hit.category,
          };
        }
      }
    }
  }

  const pooledResults = Array.from(chunkMap.values());

  // Hydration fehlender Rohtexte via chunkId
  const chunksToHydrate = pooledResults.filter((r) => !r.text);
  if (chunksToHydrate.length > 0) {
    const missingChunkIds = chunksToHydrate.map((r) => r.chunkId);
    const missingChunksFromDB = await db.documentChunks
      .where('chunkId')
      .anyOf(missingChunkIds)
      .toArray();

    const dbChunkMap = new Map(missingChunksFromDB.map((c) => [c.chunkId, c]));

    for (const result of chunksToHydrate) {
      const found = dbChunkMap.get(result.chunkId);
      if (found) {
        result.text = found.text;
        result.pageNumber = found.pageNumber;
      } else {
        result.text = '[Rohtext nicht gefunden]';
      }
    }
  }

  // ZWINGEND: Absteigend nach BM25 Score sortieren
  return pooledResults.sort((a, b) => b.score - a.score);
}

/**
 * Führt Vektor- und Keyword-Ergebnisse mittels Reciprocal Rank Fusion (RRF) zusammen.
 */
export function applyReciprocalRankFusion(
  vectorResults: PooledChunkResult[],
  keywordResults: KeywordChunkResult[],
  k: number = RRF_K,
  vectorWeight: number = 0.7,
  bm25Weight: number = 0.3
): HybridRRFResult[] {
  const rrfMap = new Map<string, HybridRRFResult>();

  // 1. Vektor-Ergebnisse eintragen
  vectorResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScore = vectorWeight * (1 / (k + rank));

    rrfMap.set(result.chunkId, {
      chunkId: result.chunkId,
      documentId: result.documentId,
      pageNumber: result.pageNumber,
      parentChunkText: result.parentChunkText,
      rrfScore,
      vectorScore: result.maxScore,
      keywordScore: 0,
      rankVector: rank,
      rankKeyword: 0,
      triggerQuestion: result.triggerQuestion,
    });
  });

  // 2. Keyword-Ergebnisse hinzufügen oder fusionieren
  keywordResults.forEach((result, index) => {
    const rank = index + 1;
    const rrfScoreAdd = bm25Weight * (1 / (k + rank));

    if (rrfMap.has(result.chunkId)) {
      const existing = rrfMap.get(result.chunkId)!;
      existing.rrfScore += rrfScoreAdd;
      existing.rankKeyword = rank;
      existing.keywordScore = result.score;
      if (!existing.triggerQuestion && result.triggerQuestion) {
        existing.triggerQuestion = result.triggerQuestion;
      }
    } else {
      rrfMap.set(result.chunkId, {
        chunkId: result.chunkId,
        documentId: result.documentId,
        pageNumber: result.pageNumber,
        parentChunkText: result.text,
        rrfScore: rrfScoreAdd,
        vectorScore: 0,
        keywordScore: result.score,
        rankVector: 0,
        rankKeyword: rank,
        triggerQuestion: result.triggerQuestion,
      });
    }
  });

  return Array.from(rrfMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

// ─── Hauptklasse ────────────────────────────────────────────────────────────────

export class HybridSearchEngine {
  /** MiniSearch-Index für die BM25-Volltextsuche */
  private miniSearchIndex: MiniSearch<MiniSearchDoc> | null = null;

  /** Alle geladenen Chunks aus der Datenbank */
  private allChunks: DocumentChunkRecord[] = [];

  /** Alle geladenen Fragen aus der Datenbank */
  private allQuestions: GeneratedQuestionRecord[] = [];

  /** Worker für die Dichte Vektorsuche */
  private vectorSearchWorker: Worker | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.vectorSearchWorker = new Worker(
        new URL('../workers/vectorSearch.worker.ts', import.meta.url),
        { type: 'module' }
      );
    }
  }

  /**
   * Lädt Chunks und Fragen aus Dexie und initialisiert den MiniSearch Index.
   */
  async initialize(): Promise<{
    totalChunks: number;
    totalQuestions: number;
    totalPapers: number;
  }> {
    this.allChunks = await db.documentChunks.toArray();
    this.allQuestions = await db.paperQuestions.toArray();

    this.miniSearchIndex = new MiniSearch<MiniSearchDoc>({
      fields: ['text'],
      storeFields: ['id', 'chunkId', 'documentId', 'type', 'text', 'pageNumber', 'category'],
      searchOptions: {
        fuzzy: 0.2,
        prefix: true,
      },
      processTerm: (term) => normalizeLigaturesAndFontArtifacts(term).toLowerCase(),
    });

    const chunkDocs: MiniSearchDoc[] = this.allChunks.map((c) => ({
      id: `c_${c.id}`,
      chunkId: c.chunkId,
      documentId: c.documentId,
      type: 'chunk',
      text: normalizeLigaturesAndFontArtifacts(c.text),
      pageNumber: c.pageNumber,
    }));

    const questionDocs: MiniSearchDoc[] = this.allQuestions.map((q) => ({
      id: `q_${q.id}`,
      chunkId: q.chunkId,
      documentId: q.documentId,
      type: 'question',
      text: normalizeLigaturesAndFontArtifacts(`${q.question} ${q.shortAnswer}`),
      pageNumber: q.pageNumber,
      category: q.category,
    }));

    this.miniSearchIndex.addAll([...chunkDocs, ...questionDocs]);

    const uniquePaperIds = new Set([
      ...this.allChunks.map((c) => c.documentId),
      ...this.allQuestions.map((q) => q.documentId),
    ]);

    console.log(
      `[HybridSearch] Initialisiert: ${this.allChunks.length} Chunks & ${this.allQuestions.length} Fragen aus ${uniquePaperIds.size} Papers indiziert.`
    );

    return this.getIndexStats();
  }

  /**
   * Gibt aktuelle Statistiken über den aufgebauten Index zurück.
   */
  getIndexStats() {
    const uniquePaperIds = new Set([
      ...this.allChunks.map((c) => c.documentId),
      ...this.allQuestions.map((q) => q.documentId),
    ]);

    return {
      totalChunks: this.allChunks.length,
      totalQuestions: this.allQuestions.length,
      totalPapers: uniquePaperIds.size,
    };
  }

  /**
   * Hauptsuchfunktion: Multi-Vector Retrieval mit Max-Pooling und Reciprocal Rank Fusion.
   */
  async search(
    queryEmbedding: number[],
    queryText: string,
    options?: SearchOptions
  ): Promise<PaperSearchResult[]> {
    if (!this.miniSearchIndex) {
      throw new Error(
        '[HybridSearch] Engine nicht initialisiert. Bitte zuerst initialize() aufrufen.'
      );
    }

    const cleanQuery = normalizeLigaturesAndFontArtifacts(queryText);
    const topK = options?.topK ?? 30;
    const maxPapers = options?.maxPapers ?? 10;
    const categoryFilter = options?.categoryFilter;
    const vectorWeight = options?.vectorWeight ?? 0.7;
    const bm25Weight = options?.bm25Weight ?? 0.3;
    const hardFloorScore = options?.hardFloorScore ?? 0.005;

    // ── Schritt 0: Kandidaten für Vektorsuche und Keyword-Suche aufbereiten ──────
    let candidateChunks = this.allChunks;
    let candidateQuestions = this.allQuestions;

    if (categoryFilter && categoryFilter.length > 0) {
      const filterSet = new Set(categoryFilter);
      // Kategorie-Filter Paradoxon: Wenn gefiltert wird, werden NUR Fragen dieser Kategorie
      // zugelassen. Reine Rohtexte ohne passende Trigger-Frage werden komplett ignoriert!
      candidateQuestions = candidateQuestions.filter((q) => filterSet.has(q.category));
      candidateChunks = [];
    }

    // Memory-optimierte Kandidatenliste für Vektorsuche (OHNE text-Payload!)
    const vectorCandidates = [
      ...candidateChunks
        .filter((c) => c.embedding && c.embedding.length > 0)
        .map((c) => ({
          id: c.id,
          chunkId: c.chunkId,
          documentId: c.documentId,
          type: 'chunk' as const,
          pageNumber: c.pageNumber,
          embedding: c.embedding!,
        })),
      ...candidateQuestions
        .filter((q) => q.embedding && q.embedding.length > 0)
        .map((q) => ({
          id: q.id,
          chunkId: q.chunkId,
          documentId: q.documentId,
          type: 'question' as const,
          pageNumber: q.pageNumber,
          category: q.category,
          embedding: q.embedding!,
        })),
    ];

    // Schnelle Lookup-Map für Fragen-Texte (nur im Haupt-Thread)
    const questionsMap = new Map(this.allQuestions.map((q) => [q.id, q.question]));

    // ── Schritt 1: Parallele Vektor- und Keyword-Suche ────────────────────────
    const [rawVectorHits, rawKeywordHits] = await Promise.all([
      this.performDenseSearch(queryEmbedding, vectorCandidates, topK),
      Promise.resolve(this.performSparseSearch(cleanQuery, categoryFilter, topK)),
    ]);

    // ── Schritt 2: Max-Pooling auf Parent-Chunk-Ebene ─────────────────────────
    const [pooledVectorResults, pooledKeywordResults] = await Promise.all([
      aggregateMaxPooling(rawVectorHits, 0.5, questionsMap),
      aggregateKeywordHits(rawKeywordHits, questionsMap),
    ]);

    // ── Schritt 3: Reciprocal Rank Fusion (RRF) ──────────────────────────────
    const fusedChunkResults = applyReciprocalRankFusion(
      pooledVectorResults,
      pooledKeywordResults,
      RRF_K,
      vectorWeight,
      bm25Weight
    );

    // ── Schritt 4: Paper-Ebene Aggregation (Multi-Match) ─────────────────────
    const paperScores = this.aggregatePaperScores(fusedChunkResults);

    // ── Schritt 5: Sortierung & dynamischer Cutoff ───────────────────────────
    const sortedPapers = Array.from(paperScores.entries())
      .map(([documentId, data]) => ({ documentId, ...data }))
      .sort((a, b) => b.paperScore - a.paperScore);

    let filteredPapers = sortedPapers.filter((p) => p.paperScore >= hardFloorScore);

    if (filteredPapers.length > 1) {
      const bestScore = filteredPapers[0].paperScore;
      const relativeCutoff = 0.25 * bestScore;
      filteredPapers = filteredPapers.filter((p) => p.paperScore >= relativeCutoff);
    }

    const finalPapers = filteredPapers.slice(0, maxPapers);
    if (finalPapers.length === 0) {
      return [];
    }

    // ── Schritt 6: Dokumente laden & Ergebnis-Objekte erzeugen ──────────────
    const paperIds = finalPapers.map((p) => p.documentId);
    const documents = await db.documents.bulkGet(paperIds);

    const docMap = new Map<string, DocumentRecord>();
    for (const doc of documents) {
      if (doc) docMap.set(doc.id, doc);
    }

    const bestPaperScore = finalPapers[0].paperScore;
    const bestChunkVectorScore = finalPapers[0].topChunks[0]?.vectorScore ?? 0;

    const results: PaperSearchResult[] = [];

    for (const paper of finalPapers) {
      const doc = docMap.get(paper.documentId);
      if (!doc) continue;

      let badge: RelevanceBadge;
      if (paper.documentId === finalPapers[0].documentId) {
        badge = bestChunkVectorScore > 0.75 ? 'high' : 'related';
      } else {
        badge = paper.paperScore > 0.6 * bestPaperScore ? 'high' : 'related';
      }

      const matchedChunks: MatchedChunk[] = paper.topChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        pageNumber: chunk.pageNumber,
        parentChunkText: chunk.parentChunkText,
        rrfScore: chunk.rrfScore,
        vectorScore: chunk.vectorScore,
        keywordScore: chunk.keywordScore,
        rankVector: chunk.rankVector,
        rankKeyword: chunk.rankKeyword,
        triggerQuestion: chunk.triggerQuestion,
      }));

      results.push({
        documentId: paper.documentId,
        document: doc,
        paperScore: paper.paperScore,
        relevanceBadge: badge,
        matchedChunks,
      });
    }

    return results;
  }

  // ─── Private Hilfsmethoden ──────────────────────────────────────────────────

  /**
   * Führt die dichte Vektorsuche über den Web Worker (oder Fallback) aus.
   */
  private async performDenseSearch(
    queryEmbedding: number[],
    candidates: {
      id: string;
      chunkId: string;
      documentId: string;
      type: 'chunk' | 'question';
      pageNumber: number;
      category?: QuestionCategory;
      embedding: number[];
    }[],
    topK: number
  ): Promise<RawVectorHit[]> {
    if (candidates.length === 0) return [];

    const worker = this.vectorSearchWorker;
    if (worker) {
      return new Promise<RawVectorHit[]>((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const handleMessage = (event: MessageEvent) => {
          const data = event.data;
          if (data?.payload?.requestId !== requestId) return;

          if (data.type === 'DENSE_SEARCH_RESULT') {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            resolve(data.payload.results as RawVectorHit[]);
          } else if (data.type === 'DENSE_SEARCH_ERROR') {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
            reject(new Error(data.payload.error));
          }
        };

        const handleError = (event: ErrorEvent) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          reject(new Error(event.message || 'Worker-Fehler'));
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        worker.postMessage({
          type: 'DENSE_SEARCH',
          payload: {
            requestId,
            queryEmbedding,
            candidates,
            topK,
          },
        });
      });
    }

    // Fallback: Hauptthread
    const scored = candidates.map((c) => {
      const { embedding, ...rest } = c;
      return {
        ...rest,
        score: cosineSimilarity(queryEmbedding, embedding),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Führt die BM25-Schlüsselwortsuche über MiniSearch durch.
   */
  private performSparseSearch(
    queryText: string,
    categoryFilter?: QuestionCategory[],
    topK: number = 30
  ): RawKeywordHit[] {
    if (!this.miniSearchIndex || !queryText.trim()) {
      return [];
    }

    const rawResults = this.miniSearchIndex.search(queryText);
    const filterSet = categoryFilter && categoryFilter.length > 0 ? new Set(categoryFilter) : null;

    const filtered: RawKeywordHit[] = [];

    for (const result of rawResults) {
      const item = result as unknown as MiniSearchDoc & { score: number };

      // Wenn Filter aktiv ist: Nur Fragen mit passender Kategorie
      if (filterSet) {
        if (item.type !== 'question' || !item.category || !filterSet.has(item.category)) {
          continue;
        }
      }

      filtered.push({
        id: item.id,
        chunkId: item.chunkId,
        documentId: item.documentId,
        score: item.score,
        type: item.type,
        text: item.text,
        pageNumber: item.pageNumber,
        category: item.category,
      });

      if (filtered.length >= topK) break;
    }

    return filtered;
  }

  /**
   * Aggregiert fusionierte Chunks auf Paper-Ebene nach Multi-Match Scoring.
   */
  private aggregatePaperScores(
    fusedResults: HybridRRFResult[]
  ): Map<string, { paperScore: number; topChunks: HybridRRFResult[] }> {
    const paperGroups = new Map<string, HybridRRFResult[]>();

    for (const res of fusedResults) {
      const group = paperGroups.get(res.documentId);
      if (group) {
        group.push(res);
      } else {
        paperGroups.set(res.documentId, [res]);
      }
    }

    const result = new Map<string, { paperScore: number; topChunks: HybridRRFResult[] }>();

    paperGroups.forEach((chunks, docId) => {
      chunks.sort((a, b) => b.rrfScore - a.rrfScore);
      const topChunks = chunks.slice(0, 3);

      let paperScore = 0;
      for (let i = 0; i < topChunks.length; i++) {
        const weight = MULTI_MATCH_WEIGHTS[i] ?? 0;
        paperScore += weight * topChunks[i].rrfScore;
      }

      result.set(docId, { paperScore, topChunks });
    });

    return result;
  }
}

/** Singleton-Instanz der hybriden Suchmaschine */
export const searchEngine = new HybridSearchEngine();

