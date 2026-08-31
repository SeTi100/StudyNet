import { DocumentRecord } from '../db/schema';

/**
 * Formatiert Autoren nach APA 7th Edition Richtlinien.
 */
function formatAuthorsList(authors: string[]): string {
  const cleanAuthors = authors.map((a) => a.trim()).filter(Boolean);
  if (cleanAuthors.length === 0) return '';
  if (cleanAuthors.length === 1) return cleanAuthors[0];
  if (cleanAuthors.length === 2) return `${cleanAuthors[0]} & ${cleanAuthors[1]}`;
  if (cleanAuthors.length <= 7) {
    return `${cleanAuthors.slice(0, -1).join(', ')}, & ${cleanAuthors[cleanAuthors.length - 1]}`;
  }
  return `${cleanAuthors.slice(0, 6).join(', ')}, et al.`;
}

/**
 * Erstellt eine standardisierte Zitation im APA-Format:
 * z.B. "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. https://doi.org/10.48550/arXiv.1706.03762"
 */
export function formatApaCitation(doc: DocumentRecord): string {
  const hasValidAuthors =
    doc.authors &&
    doc.authors.length > 0 &&
    doc.authors[0] !== 'Unknown Author' &&
    doc.authors[0] !== 'Unbekannter Autor';

  const authorsStr = hasValidAuthors ? formatAuthorsList(doc.authors) : '';
  const yearStr = doc.publicationYear ? ` (${doc.publicationYear})` : '';
  const titleStr = doc.title ? (doc.title.trim().endsWith('.') ? doc.title.trim() : `${doc.title.trim()}.`) : '';

  let doiUrl = '';
  if (doc.doi) {
    const cleanDoi = doc.doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    doiUrl = ` https://doi.org/${cleanDoi}`;
  }

  if (authorsStr) {
    return `${authorsStr}${yearStr}. ${titleStr}${doiUrl}`.trim();
  }
  if (yearStr) {
    return `${titleStr}${yearStr}.${doiUrl}`.trim();
  }
  return `${titleStr}${doiUrl}`.trim();
}

/**
 * Erstellt einen standardisierten BibTeX-Eintrag für Literaturverwaltungsprogramme (Zotero, Mendeley, Overleaf, LaTeX).
 */
export function formatBibtexCitation(doc: DocumentRecord): string {
  const firstAuthorRaw = doc.authors?.[0] || 'doc';
  const firstAuthorName = firstAuthorRaw.split(',')[0].split(' ').pop()?.replace(/[^a-zA-Z]/g, '').toLowerCase() || 'paper';
  const year = doc.publicationYear || new Date().getFullYear();
  const citeKey = `${firstAuthorName}${year}`;

  const fields = [
    `  title = {${doc.title}}`,
    doc.authors?.length ? `  author = {${doc.authors.join(' and ')}}` : null,
    doc.publicationYear ? `  year = {${doc.publicationYear}}` : null,
    doc.doi ? `  doi = {${doc.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}}` : null,
  ]
    .filter(Boolean)
    .join(',\n');

  return `@article{${citeKey},\n${fields}\n}`;
}
