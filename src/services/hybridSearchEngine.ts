/**
 * @file hybridSearchEngine.ts
 * Kern-Suchmaschine: Kombiniert dichte Vektorsuche (Cosine Similarity)
 * mit dünnbesetzter BM25-Schlüsselwortsuche (MiniSearch) über Reciprocal Rank Fusion (RRF).
 * Ergebnisse werden auf Paper-Ebene mittels Multi-Match-Scoring aggregiert.
 */

import MiniSearch from 'minisearch';
import { db } from '../db/schema';
import type { DocumentRecord, GeneratedQuestionRecord, QuestionCategory } from '../db/schema';
import { cosineSimilarity } from '../utils/vectorMath';

// ─── Exportierte Typen ──────────────────────────────────────────────────────────

/** Relevanz-Badge für die visuelle Darstellung im UI */
export type RelevanceBadge = 'high' | 'related';

/** Eine einzelne Frage, die beim Matching getroffen wurde */
export interface MatchedQuestion {
  /** Die originale Frage aus der Datenbank */
  question: GeneratedQuestionRecord;
  /** Roher Kosinus-Ähnlichkeitswert [0, 1] */
  vectorScore: number;
  /** Kombinierter RRF-Score aus Vektor- und BM25-Suche */
  rrfScore: number;
}

/** Aggregiertes Suchergebnis auf Paper-Ebene */
export interface PaperSearchResult {
  /** ID des zugehörigen Dokuments */
  documentId: string;
  /** Vollständiger Dokument-Record aus Dexie */
  document: DocumentRecord;
  /** Aggregierter Multi-Match-Score des Papers */
  paperScore: number;
  /** Visuelle Relevanz-Einstufung */
  relevanceBadge: RelevanceBadge;
  /** Die besten 3 gematchten Fragen für dieses Paper */
  matchedQuestions: MatchedQuestion[];
}

/** Suchoptionen zur Steuerung der Hybrid-Suche */
export interface SearchOptions {
  /** Maximale Ergebnisse pro Suchmethode (Standard: 20) */
  topK?: number;
  /** Maximale Anzahl zurückgegebener Papers (Standard: 10) */
  maxPapers?: number;
  /** Optionaler Filter: Nur Fragen dieser Kategorien einbeziehen */
  categoryFilter?: QuestionCategory[];
  /** Gewichtung der Vektorsuche im RRF (Standard: 0.7) */
  vectorWeight?: number;
  /** Gewichtung der BM25-Suche im RRF (Standard: 0.3) */
  bm25Weight?: number;
  /** Mindest-Score für Aufnahme ins Ergebnis (Standard: 0.01) */
  hardFloorScore?: number;
}

// ─── Interne Hilfstypen ─────────────────────────────────────────────────────────

/** Interner Typ für die RRF-Fusion einer einzelnen Frage */
interface FusedQuestionScore {
  questionId: string;
  vectorScore: number;
  vectorRank: number;
  bm25Rank: number;
  rrfScore: number;
}

/** RRF-Konstante k – Standard-Wert aus der Literatur (Cormack et al.) */
const RRF_K = 60;

/** Gewichtungen für die Multi-Match-Aggregation der Top-3 Fragen pro Paper */
const MULTI_MATCH_WEIGHTS = [1.0, 0.5, 0.25];

// ─── Hauptklasse ────────────────────────────────────────────────────────────────

/**
 * Hybride Suchmaschine: Kombiniert Vektor- und BM25-Suche via RRF
 * und aggregiert Ergebnisse auf Paper-Ebene.
 *
 * Nutzung:
 * ```ts
 * const engine = new HybridSearchEngine();
 * await engine.initialize();
 * const results = await engine.search(queryEmbedding, queryText);
 * ```
 */
export class HybridSearchEngine {
  /** MiniSearch-Index für die BM25-Schlüsselwortsuche */
  private miniSearchIndex: MiniSearch | null = null;

  /** Alle geladenen Fragen aus der Datenbank (mit Embeddings) */
  private allQuestions: GeneratedQuestionRecord[] = [];

  /**
   * Lade alle Fragen aus Dexie und baue den MiniSearch-Index auf.
   * Muss einmal aufgerufen werden, bevor `search()` genutzt wird.
   *
   * @returns Anzahl geladener Fragen und eindeutiger Papers
   */
  async initialize(): Promise<{ totalQuestions: number; totalPapers: number }> {
    // Alle Fragen aus der IndexedDB laden
    this.allQuestions = await db.paperQuestions.toArray();

    // MiniSearch-Index aufbauen
    this.miniSearchIndex = new MiniSearch<GeneratedQuestionRecord>({
      fields: ['question', 'shortAnswer'],       // Suchbare Felder
      storeFields: ['id', 'documentId'],          // Im Ergebnis gespeicherte Felder
      searchOptions: {
        fuzzy: 0.2,   // Unschärfe für Tippfehler-Toleranz
        prefix: true, // Prefix-Suche erlauben
      },
    });

    // Alle Fragen in den Index aufnehmen
    this.miniSearchIndex.addAll(this.allQuestions);

    // Eindeutige Paper-IDs zählen
    const uniquePaperIds = new Set(this.allQuestions.map((q) => q.documentId));

    console.log(
      `[HybridSearch] Initialisiert: ${this.allQuestions.length} Fragen aus ${uniquePaperIds.size} Papers indiziert.`
    );

    return {
      totalQuestions: this.allQuestions.length,
      totalPapers: uniquePaperIds.size,
    };
  }

  /**
   * Hauptsuche: Kombiniert Vektor + BM25 + RRF + Paper-Aggregation.
   *
   * @param queryEmbedding - Embedding-Vektor der Suchanfrage (z.B. 384-dim)
   * @param queryText - Klartext der Suchanfrage für BM25
   * @param options - Optionale Suchparameter
   * @returns Sortierte Liste von Paper-Ergebnissen mit gematchten Fragen
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

    // Optionen mit Standardwerten zusammenführen
    const topK = options?.topK ?? 20;
    const maxPapers = options?.maxPapers ?? 10;
    const categoryFilter = options?.categoryFilter;
    const vectorWeight = options?.vectorWeight ?? 0.7;
    const bm25Weight = options?.bm25Weight ?? 0.3;
    const hardFloorScore = options?.hardFloorScore ?? 0.01;

    // ── Schritt 0: Kategorie-Filter anwenden ────────────────────────────────
    let candidates = this.allQuestions;
    if (categoryFilter && categoryFilter.length > 0) {
      const filterSet = new Set(categoryFilter);
      candidates = candidates.filter((q) => filterSet.has(q.category));
    }

    // ── Schritt 1: Dichte Vektorsuche (Cosine Similarity) ───────────────────
    const denseResults = this.performDenseSearch(queryEmbedding, candidates, topK);

    // ── Schritt 2: Dünnbesetzte BM25-Suche (MiniSearch) ────────────────────
    const sparseResults = this.performSparseSearch(queryText, candidates, topK);

    // ── Schritt 3: Reciprocal Rank Fusion (RRF) ────────────────────────────
    const fusedScores = this.reciprocalRankFusion(
      denseResults,
      sparseResults,
      topK,
      vectorWeight,
      bm25Weight
    );

    // ── Schritt 4: Paper-Ebene Aggregation (Multi-Match) ───────────────────
    const paperScores = this.aggregatePaperScores(fusedScores);

    // ── Schritt 5: Sortierung und Cutoff ───────────────────────────────────
    const sortedPapers = Array.from(paperScores.entries())
      .map(([documentId, data]) => ({ documentId, ...data }))
      .sort((a, b) => b.paperScore - a.paperScore);

    // Hard Floor: Papers unter Mindest-Score entfernen
    let filteredPapers = sortedPapers.filter((p) => p.paperScore >= hardFloorScore);

    // Dynamischer Cutoff: Relative Schwelle zum besten Paper
    if (filteredPapers.length > 1) {
      const bestScore = filteredPapers[0].paperScore;
      const relativeCutoff = 0.3 * bestScore;
      filteredPapers = filteredPapers.filter((p) => p.paperScore >= relativeCutoff);
    }

    // Maximale Anzahl Papers begrenzen
    const finalPapers = filteredPapers.slice(0, maxPapers);

    if (finalPapers.length === 0) {
      return [];
    }

    // ── Schritt 6: DocumentRecords aus Dexie laden ─────────────────────────
    const paperIds = finalPapers.map((p) => p.documentId);
    const documents = await db.documents.bulkGet(paperIds);

    // Map für schnellen Zugriff auf DocumentRecords
    const docMap = new Map<string, DocumentRecord>();
    for (const doc of documents) {
      if (doc) {
        docMap.set(doc.id, doc);
      }
    }

    // Fragen-Map für schnellen Zugriff
    const questionMap = new Map<string, GeneratedQuestionRecord>();
    for (const q of candidates) {
      questionMap.set(q.id, q);
    }

    // ── Schritt 7: Badge-Zuweisung ─────────────────────────────────────────
    const bestPaperScore = finalPapers[0].paperScore;
    const bestQuestionVectorScore = finalPapers[0].topQuestions[0]?.vectorScore ?? 0;

    // Ergebnis-Objekte aufbauen
    const results: PaperSearchResult[] = [];

    for (const paper of finalPapers) {
      const doc = docMap.get(paper.documentId);
      if (!doc) {
        // Dokument wurde möglicherweise gelöscht – überspringen
        continue;
      }

      // Badge-Logik: Kombination aus absolutem und relativem Kriterium
      let badge: RelevanceBadge;

      if (paper.documentId === finalPapers[0].documentId) {
        // Bestes Paper: Badge basiert auf absolutem Vektor-Score
        badge = bestQuestionVectorScore > 0.75 ? 'high' : 'related';
      } else {
        // Weitere Papers: Badge basiert auf relativem Paper-Score
        badge = paper.paperScore > 0.6 * bestPaperScore ? 'high' : 'related';
      }

      // MatchedQuestions aus den Fused Scores aufbauen
      const matchedQuestions: MatchedQuestion[] = paper.topQuestions
        .map((tq) => {
          const questionRecord = questionMap.get(tq.questionId);
          if (!questionRecord) return null;
          return {
            question: questionRecord,
            vectorScore: tq.vectorScore,
            rrfScore: tq.rrfScore,
          };
        })
        .filter((mq): mq is MatchedQuestion => mq !== null);

      results.push({
        documentId: paper.documentId,
        document: doc,
        paperScore: paper.paperScore,
        relevanceBadge: badge,
        matchedQuestions,
      });
    }

    return results;
  }

  // ─── Private Hilfsmethoden ──────────────────────────────────────────────────

  /**
   * Führt die dichte Vektorsuche mittels Cosine Similarity durch.
   * Nur Fragen mit vorhandenem Embedding werden berücksichtigt.
   *
   * @returns Sortierte Liste der Top-K Ergebnisse mit Question-ID und Score
   */
  private performDenseSearch(
    queryEmbedding: number[],
    candidates: GeneratedQuestionRecord[],
    topK: number
  ): { questionId: string; score: number }[] {
    const scored: { questionId: string; score: number }[] = [];

    for (const question of candidates) {
      if (!question.embedding || question.embedding.length === 0) {
        continue; // Fragen ohne Embedding überspringen
      }

      const score = cosineSimilarity(queryEmbedding, question.embedding);
      scored.push({ questionId: question.id, score });
    }

    // Absteigend nach Score sortieren und Top-K zurückgeben
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Führt die BM25-Schlüsselwortsuche über MiniSearch durch.
   * Bei aktivem Kategorie-Filter werden nur passende Ergebnisse zurückgegeben.
   *
   * @returns Sortierte Liste der Top-K BM25-Ergebnisse
   */
  private performSparseSearch(
    queryText: string,
    candidates: GeneratedQuestionRecord[],
    topK: number
  ): { questionId: string; score: number }[] {
    if (!this.miniSearchIndex || !queryText.trim()) {
      return [];
    }

    // MiniSearch gibt bereits nach BM25-Score sortierte Ergebnisse zurück
    const rawResults = this.miniSearchIndex.search(queryText);

    // Bei Kategorie-Filter: Nur Ergebnisse behalten, die in candidates enthalten sind
    const candidateIds = new Set(candidates.map((c) => c.id));

    const filtered = rawResults
      .filter((result) => candidateIds.has(String(result.id)))
      .slice(0, topK)
      .map((result) => ({
        questionId: String(result.id),
        score: result.score,
      }));

    return filtered;
  }

  /**
   * Reciprocal Rank Fusion (RRF): Kombiniert Rang-Listen aus Vektor-
   * und BM25-Suche zu einem einheitlichen Score.
   *
   * Formel: rrfScore = w_vec * (1 / (k + vectorRank)) + w_bm25 * (1 / (k + bm25Rank))
   * wobei k = 60 (Standardwert aus der Literatur).
   *
   * Fragen, die in einer Liste nicht vorkommen, erhalten Rang topK+1 (Strafterm).
   */
  private reciprocalRankFusion(
    denseResults: { questionId: string; score: number }[],
    sparseResults: { questionId: string; score: number }[],
    topK: number,
    vectorWeight: number,
    bm25Weight: number
  ): FusedQuestionScore[] {
    // Rang-Maps aufbauen (1-indiziert)
    const vectorRankMap = new Map<string, { rank: number; score: number }>();
    for (let i = 0; i < denseResults.length; i++) {
      vectorRankMap.set(denseResults[i].questionId, {
        rank: i + 1,
        score: denseResults[i].score,
      });
    }

    const bm25RankMap = new Map<string, number>();
    for (let i = 0; i < sparseResults.length; i++) {
      bm25RankMap.set(sparseResults[i].questionId, i + 1);
    }

    // Alle einzigartigen Question-IDs sammeln
    const allQuestionIds = new Set<string>();
    vectorRankMap.forEach((_, id) => allQuestionIds.add(id));
    bm25RankMap.forEach((_, id) => allQuestionIds.add(id));

    const defaultRank = topK + 1; // Strafrang für fehlende Einträge

    const fused: FusedQuestionScore[] = [];

    allQuestionIds.forEach((questionId) => {
      const vectorEntry = vectorRankMap.get(questionId);
      const vectorRank = vectorEntry?.rank ?? defaultRank;
      const vectorScore = vectorEntry?.score ?? 0;
      const bm25Rank = bm25RankMap.get(questionId) ?? defaultRank;

      // RRF-Formel anwenden
      const rrfScore =
        vectorWeight * (1 / (RRF_K + vectorRank)) +
        bm25Weight * (1 / (RRF_K + bm25Rank));

      fused.push({
        questionId,
        vectorScore,
        vectorRank,
        bm25Rank,
        rrfScore,
      });
    });

    // Nach RRF-Score absteigend sortieren
    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    return fused;
  }

  /**
   * Aggregiert die fusionierten Fragen-Scores auf Paper-Ebene.
   * Für jedes Paper werden die Top-3 Fragen nach RRF-Score genommen
   * und mit absteigenden Gewichten (1.0, 0.5, 0.25) zum Paper-Score summiert.
   */
  private aggregatePaperScores(
    fusedScores: FusedQuestionScore[]
  ): Map<
    string,
    {
      paperScore: number;
      topQuestions: FusedQuestionScore[];
    }
  > {
    // Frage-ID → documentId Lookup
    const questionToDoc = new Map<string, string>();
    for (const q of this.allQuestions) {
      questionToDoc.set(q.id, q.documentId);
    }

    // Nach documentId gruppieren
    const paperGroups = new Map<string, FusedQuestionScore[]>();

    for (const fused of fusedScores) {
      const docId = questionToDoc.get(fused.questionId);
      if (!docId) continue;

      const group = paperGroups.get(docId);
      if (group) {
        group.push(fused);
      } else {
        paperGroups.set(docId, [fused]);
      }
    }

    // Pro Paper: Top-3 Fragen auswählen und gewichtet summieren
    const result = new Map<
      string,
      { paperScore: number; topQuestions: FusedQuestionScore[] }
    >();

    paperGroups.forEach((questions, docId) => {
      // Bereits nach RRF-Score sortiert (erbt Sortierung von fusedScores),
      // aber zur Sicherheit nochmal sortieren
      questions.sort((a, b) => b.rrfScore - a.rrfScore);

      const topQuestions = questions.slice(0, 3);

      // Multi-Match-Scoring: Gewichtete Summe der Top-3
      let paperScore = 0;
      for (let i = 0; i < topQuestions.length; i++) {
        const weight = MULTI_MATCH_WEIGHTS[i] ?? 0;
        paperScore += weight * topQuestions[i].rrfScore;
      }

      result.set(docId, { paperScore, topQuestions });
    });

    return result;
  }
}

/** Singleton-Instanz der hybriden Suchmaschine */
export const searchEngine = new HybridSearchEngine();
