import { DocumentRecord } from '../db/schema';

const INSTITUTION_KEYWORDS = [
  'organization', 'organisation', 'institute', 'institut', 'association',
  'consortium', 'university', 'universität', 'department', 'committee',
  'commission', 'agency', 'society', 'foundation', 'group', 'team',
  'who', 'ieee', 'acm', 'nih', 'cdc', 'center', 'centre'
];

const SURNAME_PREFIXES = new Set([
  'von', 'van', 'de', 'del', 'della', 'der', 'den', 'du', 'la', 'le',
  'da', 'di', 'dos', 'das', 'al', 'el', 'bin', 'ibn', 'ter', 'ten', 'zu', 'vom'
]);

const SUFFIXES = new Set([
  'jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v'
]);

/**
 * Formatiert einen Autornamen nach dem offiziellen RIS-Standard für Citavi:
 * - Personen: "Nachname, Vorname" (z.B. "Kamal, Muhammad Shahzad", "van Rossum, Guido", "Smith, John, Jr.")
 * - Institutionen: "World Health Organization," (mit abschließendem Komma)
 */
export function formatAuthorForRis(rawAuthor: string): string {
  const trimmed = rawAuthor.trim();
  if (!trimmed || trimmed === 'Unknown Author') return '';

  // 1. Wenn bereits ein Komma vorhanden ist (z.B. durch OpenAlex/PubMed Metadaten), so belassen
  if (trimmed.includes(',')) {
    return trimmed;
  }

  // 2. Prüfen, ob es sich um eine Institution/Organisation handelt
  const lower = trimmed.toLowerCase();
  const isInstitution = INSTITUTION_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`, 'i').test(lower)
  );

  if (isInstitution) {
    return `${trimmed},`;
  }

  // 3. Personen in Einzelteile zerlegen
  let parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return `${parts[0]},`;
  }

  // Suffix erkennen (z.B. "Jr.", "III")
  let suffix = '';
  const lastPartLower = parts[parts.length - 1].toLowerCase();
  if (SUFFIXES.has(lastPartLower) && parts.length > 2) {
    suffix = parts.pop()!;
  }

  // Mehrteilige Nachnamen mit Präfixen erkennen (z.B. "van Rossum", "von Neumann", "de la Torre")
  let lastNameParts: string[] = [parts.pop()!];
  while (parts.length > 1 && SURNAME_PREFIXES.has(parts[parts.length - 1].toLowerCase())) {
    lastNameParts.unshift(parts.pop()!);
  }

  const lastName = lastNameParts.join(' ');
  const firstNames = parts.join(' ');
  const suffixStr = suffix ? `, ${suffix}` : '';

  return `${lastName}, ${firstNames}${suffixStr}`;
}

/**
 * Teilt mögliche kombinierte Autoren-Strings ("Author A and Author B" oder "A; B")
 * auf und formatiert jeden einzelnen Autor separat.
 */
export function extractIndividualAuthors(authorsList: string[]): string[] {
  const result: string[] = [];
  for (const item of authorsList) {
    if (!item) continue;
    const splitParts = item.split(/\s*;\s*|\s+(?:and|und|&)\s+/i);
    for (const part of splitParts) {
      const formatted = formatAuthorForRis(part);
      if (formatted) {
        result.push(formatted);
      }
    }
  }
  return result;
}

/**
 * Generiert standardisiertes RIS-Format (Research Information Systems),
 * das nativ von Citavi, EndNote, Zotero und Word-Erweiterungen importiert wird.
 */
export function generateRisContent(
  doc: DocumentRecord,
  selectedText?: string,
  pageNumber?: number
): string {
  const lines: string[] = [];

  // TY - Dokumenttyp (JOUR = Journal Article / Paper)
  lines.push('TY  - JOUR');

  // TI - Titel
  if (doc.title) {
    lines.push(`TI  - ${doc.title.replace(/\r?\n/g, ' ').trim()}`);
  }

  // AU - Autoren (jeder Autor eigene AU-Zeile im Format: "Nachname, Vorname")
  if (doc.authors && doc.authors.length > 0) {
    const formattedAuthors = extractIndividualAuthors(doc.authors);
    for (const author of formattedAuthors) {
      lines.push(`AU  - ${author}`);
    }
  }

  // PY / Y1 - Erscheinungsjahr
  if (doc.publicationYear) {
    lines.push(`PY  - ${doc.publicationYear}`);
    lines.push(`Y1  - ${doc.publicationYear}`);
  }

  // DO & UR - DOI und URL
  if (doc.doi) {
    const cleanDoi = doc.doi.replace(/^https?:\/\/doi\.org\//, '').trim();
    lines.push(`DO  - ${cleanDoi}`);
    lines.push(`UR  - https://doi.org/${cleanDoi}`);
  }

  // SP / EP - Seitenzahl im Dokument
  if (typeof pageNumber === 'number' && pageNumber >= 1) {
    lines.push(`SP  - ${pageNumber}`);
    lines.push(`EP  - ${pageNumber}`);
  }

  // N1 - Zitat / Notiz als Wissenselement für Citavi
  if (selectedText && selectedText.trim()) {
    const quoteText = selectedText.trim().replace(/\r?\n/g, ' ');
    const noteContent = pageNumber
      ? `Direktes Zitat (Seite ${pageNumber}): "${quoteText}"`
      : `Zitat: "${quoteText}"`;

    lines.push(`N1  - ${noteContent}`);
    lines.push(`AB  - ${quoteText}`);
  }

  // ER - Ende des Eintrags
  lines.push('ER  - ');
  lines.push('');

  return lines.join('\r\n');
}

/**
 * Erzeugt eine .ris Datei mit UTF-8 BOM und löst den Browser-Download aus.
 * Durch den UTF-8 BOM und das "Nachname, Vorname" Format öffnet Citavi die Datei direkt ohne Abfrage-Dialoge.
 */
export function downloadRisFile(
  doc: DocumentRecord,
  selectedText?: string,
  pageNumber?: number
): void {
  const risContent = generateRisContent(doc, selectedText, pageNumber);

  // UTF-8 BOM (\uFEFF) voranstellen, damit Citavi das UTF-8 Encoding sofort ohne Nachfrage erkennt
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + risContent], {
    type: 'application/x-research-info-systems;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);

  // Dateiname z.B. "Citavi_Kamal_2024_p7.ris"
  const firstAuthor = doc.authors?.[0] ? formatAuthorForRis(doc.authors[0]) : 'Reference';
  const cleanAuthor = firstAuthor.split(',')[0].replace(/[^a-zA-Z0-9_-]/g, '') || 'Reference';
  const yearStr = doc.publicationYear ? `_${doc.publicationYear}` : '';
  const pageStr = pageNumber ? `_p${pageNumber}` : '';
  const filename = `Citavi_${cleanAuthor}${yearStr}${pageStr}.ris`;

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
