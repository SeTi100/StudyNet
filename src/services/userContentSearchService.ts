import { db, DocumentRecord, NoteRecord, AnnotationRecord } from '../db/schema';

export interface UserContentMatch {
  id: string;
  type: 'note' | 'annotation';
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  title?: string;
  comment?: string;
  selectedText?: string;
  snippet: string;
  updatedAt?: Date;
  matchScore: number;
}

/**
 * Erzeugt einen formatierten Textausschnitt (Snippet) um das gefundene Suchwort herum.
 */
function createSnippet(text: string, queryWords: string[], maxChars: number = 160): string {
  if (!text || text.length === 0) return '';
  const lowerText = text.toLowerCase();
  
  // Finde das erste Vorkommen eines der Suchwörter
  let bestPos = -1;
  for (const word of queryWords) {
    if (word.length < 2) continue;
    const pos = lowerText.indexOf(word.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    return text.length > maxChars ? text.substring(0, maxChars) + '...' : text;
  }

  const start = Math.max(0, bestPos - 40);
  const end = Math.min(text.length, start + maxChars);
  let snippet = text.substring(start, end).trim();

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Durchsucht persönliche Notizen und Text-Markierungen (Highlights/Kommentare) des Nutzers.
 */
export async function searchUserNotesAndAnnotations(query: string): Promise<UserContentMatch[]> {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery || cleanQuery.length < 2) return [];

  const queryWords = cleanQuery.split(/\s+/).filter(w => w.length >= 2);
  if (queryWords.length === 0) return [];

  const [notes, annotations, documents] = await Promise.all([
    db.notes.toArray(),
    db.annotations.toArray(),
    db.documents.toArray(),
  ]);

  const docMap = new Map<string, DocumentRecord>();
  for (const doc of documents) {
    docMap.set(doc.id, doc);
  }

  const matches: UserContentMatch[] = [];

  // ── 1. Notizen durchsuchen ───────────────────────────────────────────────
  for (const note of notes) {
    const titleLower = (note.title || '').toLowerCase();
    const contentLower = (note.content || '').toLowerCase();

    let score = 0;
    let hasMatch = false;

    // Exakter Match im Titel
    if (titleLower.includes(cleanQuery)) {
      score += 15;
      hasMatch = true;
    }
    // Exakter Match im Inhalt
    if (contentLower.includes(cleanQuery)) {
      score += 8;
      hasMatch = true;
    }

    // Keyword-Token Matching
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        score += 4;
        hasMatch = true;
      }
      if (contentLower.includes(word)) {
        score += 2;
        hasMatch = true;
      }
    }

    if (hasMatch) {
      const doc = docMap.get(note.documentId);
      const snippetSource = note.content && note.content.trim().length > 0 ? note.content : note.title;
      
      matches.push({
        id: note.id,
        type: 'note',
        documentId: note.documentId,
        documentTitle: doc?.title || 'Unbekanntes Dokument',
        pageNumber: note.linkedPage || 1,
        title: note.title || 'Ohne Titel',
        snippet: createSnippet(snippetSource, queryWords),
        updatedAt: note.updatedAt || note.createdAt,
        matchScore: score,
      });
    }
  }

  // ── 2. Annotationen & Markierungen durchsuchen ──────────────────────────
  for (const anno of annotations) {
    const commentLower = (anno.comment || '').toLowerCase();
    const selectedLower = (anno.selectedText || '').toLowerCase();

    let score = 0;
    let hasMatch = false;

    // Exakter Match im eigenen Kommentar
    if (commentLower && commentLower.includes(cleanQuery)) {
      score += 12;
      hasMatch = true;
    }
    // Exakter Match im markierten Text
    if (selectedLower && selectedLower.includes(cleanQuery)) {
      score += 6;
      hasMatch = true;
    }

    // Keyword-Token Matching
    for (const word of queryWords) {
      if (commentLower && commentLower.includes(word)) {
        score += 4;
        hasMatch = true;
      }
      if (selectedLower && selectedLower.includes(word)) {
        score += 2;
        hasMatch = true;
      }
    }

    if (hasMatch) {
      const doc = docMap.get(anno.documentId);
      const snippetSource = anno.comment ? `${anno.comment} (Markierung: ${anno.selectedText || ''})` : (anno.selectedText || '');

      matches.push({
        id: anno.id,
        type: 'annotation',
        documentId: anno.documentId,
        documentTitle: doc?.title || 'Unbekanntes Dokument',
        pageNumber: anno.pageNumber,
        comment: anno.comment,
        selectedText: anno.selectedText,
        snippet: createSnippet(snippetSource, queryWords),
        updatedAt: anno.updatedAt || anno.createdAt,
        matchScore: score,
      });
    }
  }

  // Nach Relevanz-Score sortieren (höchste zuerst)
  matches.sort((a, b) => b.matchScore - a.matchScore);

  return matches;
}
