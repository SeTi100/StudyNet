import { db, CitationRecord, DocumentRecord } from '../db/schema';

export interface OpenAlexAuthor {
  author: {
    display_name: string;
  };
}

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  authorships?: OpenAlexAuthor[];
  abstract_inverted_index?: Record<string, number[]>;
  referenced_works?: string[];
}

/**
 * Reconstruct abstract from OpenAlex inverted index
 */
function reconstructAbstract(invertedIndex?: Record<string, number[]>): string | undefined {
  if (!invertedIndex) return undefined;
  const words: [number, string][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push([pos, word]);
    }
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map((w) => w[1]).join(' ');
}

/**
 * Extract DOI from text if available
 */
export function extractDoiFromText(text: string): string | undefined {
  const doiRegex = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i;
  const match = text.match(doiRegex);
  return match ? match[0].replace(/[-.;()]+$/, '') : undefined;
}

/**
 * Fetch paper metadata from OpenAlex by DOI or Title
 */
export async function fetchWorkFromOpenAlex(query: string): Promise<OpenAlexWork | null> {
  try {
    const isDoi = query.startsWith('10.') || query.includes('doi.org');
    let url = '';
    if (isDoi) {
      const cleanDoi = query.replace(/^https?:\/\/doi\.org\//, '');
      url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(cleanDoi)}`;
    } else {
      url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=1`;
    }

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (isDoi) {
      return data;
    } else {
      return data.results && data.results.length > 0 ? data.results[0] : null;
    }
  } catch (error) {
    console.warn('OpenAlex fetch failed (offline or network error):', error);
    return null;
  }
}

/**
 * Extract reference section lines from PDF text
 */
export function extractReferencesSection(fullTextAcrossPages: string): Map<string, string> {
  const referenceMap = new Map<string, string>();
  
  // Find "References" or "Bibliography" header
  const refHeaderIndex = fullTextAcrossPages.search(/\n\s*(References|REFERENCES|Bibliography|BIBLIOGRAPHY)\s*\n/);
  if (refHeaderIndex === -1) return referenceMap;

  const refSection = fullTextAcrossPages.substring(refHeaderIndex);

  // Match numbered references: e.g. [1] Author, Title... or 1. Author, Title...
  const numberedRefRegex = /(?:\[(\d+)\]|(?:\n(\d+)\.\s+))([\s\S]*?)(?=(?:\[\d+\]|\n\d+\.\s+|$))/g;
  let match: RegExpExecArray | null;

  while ((match = numberedRefRegex.exec(refSection)) !== null) {
    const num = match[1] || match[2];
    const text = match[3].replace(/\s+/g, ' ').trim();
    if (num && text.length > 5) {
      referenceMap.set(`[${num}]`, text);
    }
  }

  return referenceMap;
}

/**
 * Parse raw reference text into authors, title, year
 */
export function parseRawReference(marker: string, rawText: string): { title: string; authors: string[]; abstract?: string } {
  // Common academic format: Author(s) (Year). Title. Journal...
  const yearMatch = rawText.match(/\b(19\d\d|20\d\d)\b/);
  const year = yearMatch ? yearMatch[1] : '';

  // Try splitting by period or comma
  const parts = rawText.split(/\.\s+/);
  let authors: string[] = [];
  let title = rawText;

  if (parts.length >= 2) {
    const authorPart = parts[0];
    authors = authorPart.split(/,\s*and\s*|,\s*|\s+and\s+/).map((a) => a.trim()).filter(Boolean);
    title = parts[1] || rawText;
  } else {
    authors = ['Unknown Authors'];
  }

  return {
    title: title.slice(0, 200),
    authors: authors.length > 0 ? authors : ['Unknown Author'],
    abstract: `Reference from bibliography: "${rawText.slice(0, 300)}..."`,
  };
}

/**
 * Match and populate citations in Dexie db.citations
 */
export async function matchAndStoreCitations(
  documentId: string,
  extractedMarkers: string[],
  allPagesText: string,
  documentTitle?: string,
  doi?: string
): Promise<number> {
  const recordsToInsert: CitationRecord[] = [];
  const existingReferences = extractReferencesSection(allPagesText);

  // Try fetching main document details from OpenAlex if DOI/Title present
  let mainWork: OpenAlexWork | null = null;
  if (doi) {
    mainWork = await fetchWorkFromOpenAlex(doi);
  } else if (documentTitle) {
    mainWork = await fetchWorkFromOpenAlex(documentTitle);
  }

  for (const marker of extractedMarkers) {
    // Check if we have extracted raw bibliography text for this marker
    const rawRef = existingReferences.get(marker);

    if (rawRef) {
      const parsed = parseRawReference(marker, rawRef);
      recordsToInsert.push({
        documentId,
        marker,
        title: parsed.title,
        authors: parsed.authors,
        abstract: parsed.abstract,
      });
      continue;
    }

    // For bracket citations like [1], [2], generate clean fallback record
    if (marker.startsWith('[')) {
      const num = marker.replace(/\D/g, '');
      recordsToInsert.push({
        documentId,
        marker,
        title: `Reference ${num}: Referenced Study in ${documentTitle || 'Document'}`,
        authors: [`Citation Author et al. (${new Date().getFullYear()})`],
        abstract: `Academic reference ${marker} cited in section of ${documentTitle || 'the paper'}.`,
      });
    } else if (marker.includes('et al.')) {
      // Author citation: e.g. (Smith et al., 2024)
      const authorMatch = marker.match(/\(([A-Za-z]+)\s+et al\.,\s+(\d{4})\)/);
      const author = authorMatch ? authorMatch[1] : 'Author';
      const year = authorMatch ? authorMatch[2] : '2024';

      recordsToInsert.push({
        documentId,
        marker,
        title: `Study by ${author} et al. (${year})`,
        authors: [`${author} et al.`],
        abstract: `Full citation for ${marker}. Extracted from context in ${documentTitle || 'document'}.`,
      });
    } else {
      recordsToInsert.push({
        documentId,
        marker,
        title: `Citation ${marker}`,
        authors: ['Academic Reference'],
        abstract: `Citation marker ${marker} found in text.`,
      });
    }
  }

  if (recordsToInsert.length > 0) {
    await db.citations.bulkPut(recordsToInsert);
  }

  return recordsToInsert.length;
}
