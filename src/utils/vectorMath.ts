/**
 * @file vectorMath.ts
 * Reine Hilfsfunktionen für Vektorarithmetik und Ähnlichkeitsberechnungen bei der semantischen Suche.
 */

/**
 * Ergebnis einer Vektor-Ähnlichkeitsbewertung.
 */
export interface ScoredResult {
  /** Eindeutige Kennung des Elements */
  id: string;
  /** Berechneter Ähnlichkeitswert (Score) */
  score: number;
}

/**
 * Element mit Text und Vektor-Embedding zur Deduplizierung.
 */
export interface EmbeddingItem {
  id: string;
  question: string;
  embedding: number[];
}

/**
 * Kandidatenelement für die Top-K-Suche.
 */
export interface CandidateItem {
  id: string;
  embedding: number[];
}

/**
 * Berechnet die Standard-Kosinus-Ähnlichkeit zwischen zwei Vektoren.
 *
 * @param a - Erster Vektor
 * @param b - Zweiter Vektor
 * @returns Kosinus-Ähnlichkeit im Wertebereich [-1, 1]
 * @throws {Error} Wenn die Vektoren unterschiedliche Längen aufweisen
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vektoren müssen die gleiche Länge haben (Vektor A: ${a.length}, Vektor B: ${b.length}).`
    );
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normASq = 0;
  let normBSq = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i];
    const valB = b[i];
    dotProduct += valA * valB;
    normASq += valA * valA;
    normBSq += valB * valB;
  }

  if (normASq === 0 || normBSq === 0) {
    return 0;
  }

  const similarity = dotProduct / (Math.sqrt(normASq) * Math.sqrt(normBSq));

  // Rundungsfehler bei Gleitkommazahlen abfangen
  return Math.max(-1, Math.min(1, similarity));
}

/**
 * Ermittelt die Top-K ähnlichsten Kandidaten zu einem Query-Embedding
 * basierend auf der Kosinus-Ähnlichkeit, absteigend nach Score sortiert.
 *
 * @param queryEmbedding - Der Vektor der Suchanfrage
 * @param candidates - Liste der Kandidaten mit ID, Embedding und beliebigen Metadaten
 * @param k - Maximale Anzahl zurückzugebender Ergebnisse
 * @returns Array der Top-K-Ergebnisse sortiert nach Ähnlichkeit (absteigend, ohne embedding-Array)
 */
export function findTopK<T extends { id: string; embedding: number[] }>(
  queryEmbedding: number[],
  candidates: T[],
  k: number
): (Omit<T, 'embedding'> & { score: number })[] {
  if (k <= 0 || candidates.length === 0) {
    return [];
  }

  const scored = candidates.map((candidate) => {
    const { embedding, ...rest } = candidate;
    return {
      ...rest,
      score: cosineSimilarity(queryEmbedding, embedding),
    } as Omit<T, 'embedding'> & { score: number };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}

/**
 * Dedupliziert Fragen/Texte anhand ihrer Embedding-Ähnlichkeit.
 * Wenn zwei Elemente eine Kosinus-Ähnlichkeit über dem Schwellenwert aufweisen,
 * wird die ID der kürzeren Frage zur Entfernung markiert.
 * Verwendet einen gierigen (greedy) Ansatz: Sortierung nach Fragenlänge absteigend,
 * bereits entfernte Elemente werden in nachfolgenden Vergleichen übersprungen.
 *
 * @param items - Liste von Objekten mit ID, Fragetext und Embedding-Vektor
 * @param threshold - Schwellenwert für die Kosinus-Ähnlichkeit (Standard: 0.88)
 * @returns Liste der IDs, die als Duplikate entfernt werden sollen
 */
export function deduplicateByEmbedding(
  items: { id: string; question: string; embedding: number[] }[],
  threshold = 0.88
): string[] {
  if (items.length <= 1) {
    return [];
  }

  // Absteigend nach Textlänge sortieren, damit längere/präzisere Fragen bevorzugt erhalten bleiben
  const sorted = [...items].sort((a, b) => b.question.length - a.question.length);
  const removedIds = new Set<string>();

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (removedIds.has(current.id)) {
      continue;
    }

    for (let j = i + 1; j < sorted.length; j++) {
      const candidate = sorted[j];
      if (removedIds.has(candidate.id) || candidate.id === current.id) {
        continue;
      }

      const similarity = cosineSimilarity(current.embedding, candidate.embedding);
      if (similarity > threshold) {
        // candidate ist kürzer oder gleich lang wie current -> candidate als Duplikat markieren
        removedIds.add(candidate.id);
      }
    }
  }

  return Array.from(removedIds);
}

/**
 * Führt eine L2-Normalisierung (Euklidische Norm) für einen Vektor durch.
 *
 * @param v - Der zu normalisierende Vektor
 * @returns Ein neuer, L2-normalisierter Vektor mit der Länge 1 (oder Kopie bei Nullvektor)
 */
export function normalizeVector(v: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < v.length; i++) {
    normSq += v[i] * v[i];
  }

  if (normSq === 0) {
    return v.slice();
  }

  const norm = Math.sqrt(normSq);
  return v.map((val) => val / norm);
}
