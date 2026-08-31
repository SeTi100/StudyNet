import { DocumentRecord } from '../db/schema';

/**
 * Normalisiert eine DOI für exakten String-Vergleich
 * (entfernt https://doi.org/, doi:, Leerzeichen und wandelt in Kleinbuchstaben um)
 */
export function normalizeDoi(doi?: string | null): string | null {
  if (!doi) return null;
  const cleaned = doi.trim().toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, '')
    .replace(/^doi:\s*/, '')
    .trim();
  return cleaned.length > 5 ? cleaned : null;
}

/**
 * Normalisiert einen Titel für robusten Textvergleich
 * (entfernt Sonderzeichen, Dateiendungen wie .pdf, Mehrfachleerzeichen und wandelt in Kleinbuchstaben um)
 */
export function normalizeTitle(title?: string | null): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Prüft, ob ein neues Paper bereits in der Liste existierender Dokumente vorhanden ist.
 * Gibt das übereinstimmende Dokument zurück oder null.
 */
export function findDuplicateDocument(
  candidate: { doi?: string | null; title?: string | null; folderRelativePath?: string | null },
  existingDocs: DocumentRecord[]
): DocumentRecord | null {
  const candidateDoi = normalizeDoi(candidate.doi);
  const candidateTitle = normalizeTitle(candidate.title);

  for (const doc of existingDocs) {
    // 1. DOI-Abgleich (Höchste Zuverlässigkeit)
    if (candidateDoi) {
      const docDoi = normalizeDoi(doc.doi);
      if (docDoi && docDoi === candidateDoi) {
        return doc;
      }
    }

    // 2. Pfad-Abgleich (identische Datei im selben Ordner)
    if (
      candidate.folderRelativePath &&
      doc.folderRelativePath &&
      candidate.folderRelativePath.toLowerCase() === doc.folderRelativePath.toLowerCase()
    ) {
      return doc;
    }

    // 3. Titel-Abgleich (falls Titel aussagekräftig und lang genug ist, min. 8 Zeichen)
    if (candidateTitle.length >= 8) {
      const docTitle = normalizeTitle(doc.title);
      if (docTitle.length >= 8 && docTitle === candidateTitle) {
        return doc;
      }
    }
  }

  return null;
}
