import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { extractDoiFromText, extractMetadataWithGemini, fetchWorkFromOpenAlex } from './citationMatchingService';
import { db, DocumentRecord } from '../db/schema';
import { getFromOPFS, getPdfFromFolder } from '../utils/opfsStorage';
import { extractCleanPageText } from '../utils/textNormalization';

// Ensure worker is configured
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface ExtractedMetadata {
  title: string;
  authors: string[];
  doi?: string;
  totalPages: number;
  publicationYear?: number;
}

/**
 * Extracts comprehensive metadata from a PDF file using:
 * 1. Embedded PDF metadata (info.Title, info.Author)
 * 2. First-page text extraction
 * 3. DOI extraction & OpenAlex lookup
 * 4. Gemini AI metadata parsing (if API key is configured)
 * 5. OpenAlex text search fallback
 */
export async function extractPdfMetadata(
  fileOrBuffer: File | ArrayBuffer,
  defaultName: string
): Promise<ExtractedMetadata> {
  const arrayBuffer = fileOrBuffer instanceof File 
    ? await fileOrBuffer.arrayBuffer() 
    : fileOrBuffer;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const totalPages = pdf.numPages;

  let title = defaultName.replace(/\.pdf$/i, '');
  let authors: string[] = [];
  let doi: string | undefined = undefined;
  let publicationYear: number | undefined = new Date().getFullYear();

  // 1. Embedded PDF info metadata
  try {
    const metadata = await pdf.getMetadata();
    const info = metadata?.info as any;
    if (info?.Title && info.Title.trim().length > 3 && !info.Title.toLowerCase().endsWith('.pdf')) {
      title = info.Title.trim();
    }
    if (info?.Author && info.Author.trim().length > 0) {
      const raw = info.Author.trim();
      const parsed = raw.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
      if (parsed.length > 0) {
        authors = parsed;
      }
    }
    if (info?.CreationDate) {
      const match = String(info.CreationDate).match(/D:(\d{4})/);
      if (match) {
        publicationYear = parseInt(match[1], 10);
      }
    }
  } catch (err) {
    console.warn('Embedded PDF metadata extraction fallback:', err);
  }

  // 2. Page 1 text extraction
  try {
    const page1 = await pdf.getPage(1);
    const firstPageText = await extractCleanPageText(page1);
    
    const extractedDoi = extractDoiFromText(firstPageText);
    if (extractedDoi) {
      doi = extractedDoi;
    }

    // A. Gemini Metadata extraction (if API key configured)
    const geminiData = await extractMetadataWithGemini(firstPageText);
    if (geminiData) {
      if (geminiData.title && geminiData.title.length > 3) title = geminiData.title;
      if (geminiData.authors && geminiData.authors.length > 0) authors = geminiData.authors;
      if (geminiData.doi) doi = geminiData.doi.replace('https://doi.org/', '');
    }

    // B. OpenAlex lookup via DOI
    if (doi) {
      const openAlexData = await fetchWorkFromOpenAlex(doi);
      if (openAlexData) {
        if (openAlexData.title) title = openAlexData.title;
        if (openAlexData.authorships && openAlexData.authorships.length > 0) {
          authors = openAlexData.authorships.map((a: any) => a.author?.display_name || 'Unknown');
        }
        if (openAlexData.publication_year) {
          publicationYear = openAlexData.publication_year;
        }
      }
    } else if (title === defaultName.replace(/\.pdf$/i, '') || authors.length === 0 || authors[0] === 'Unknown Author') {
      // C. Fallback: Search OpenAlex by first ~150 chars of first page
      const query = firstPageText.substring(0, 150).replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
      if (query.length > 20) {
        const openAlexData = await fetchWorkFromOpenAlex(query);
        if (openAlexData) {
          if (openAlexData.title) title = openAlexData.title;
          if (openAlexData.authorships && openAlexData.authorships.length > 0) {
            authors = openAlexData.authorships.map((a: any) => a.author?.display_name || 'Unknown');
          }
          if (openAlexData.doi) doi = openAlexData.doi.replace('https://doi.org/', '');
          if (openAlexData.publication_year) {
            publicationYear = openAlexData.publication_year;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Text/Online metadata extraction failed:', err);
  }

  // Final fallback for authors
  if (authors.length === 0) {
    authors = ['Unknown Author'];
  }

  return {
    title,
    authors,
    doi,
    totalPages,
    publicationYear,
  };
}

/**
 * Enriches an existing document in Dexie if its authors or page count are missing.
 */
export async function enrichDocumentMetadata(
  doc: DocumentRecord,
  folderHandle?: FileSystemDirectoryHandle | null
): Promise<DocumentRecord> {
  const hasValidAuthors = doc.authors && doc.authors.length > 0 && doc.authors[0] !== 'Unknown Author';
  if (hasValidAuthors && doc.totalPages > 1 && doc.title && !doc.title.endsWith('.pdf')) {
    return doc;
  }

  try {
    let file: File;
    if (doc.sourceType === 'folder' && doc.folderRelativePath && folderHandle) {
      file = await getPdfFromFolder(folderHandle, doc.folderRelativePath);
    } else if (doc.pdfOpfsPath) {
      file = await getFromOPFS(doc.pdfOpfsPath);
    } else {
      return doc;
    }

    const metadata = await extractPdfMetadata(file, doc.title);
    const updates: Partial<DocumentRecord> = {
      title: metadata.title,
      authors: metadata.authors,
      totalPages: metadata.totalPages,
      publicationYear: metadata.publicationYear || doc.publicationYear,
      doi: metadata.doi || doc.doi,
    };

    await db.documents.update(doc.id, updates);
    return { ...doc, ...updates };
  } catch (err) {
    console.warn(`Could not enrich document ${doc.id}:`, err);
    return doc;
  }
}
