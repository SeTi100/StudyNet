import { db, NoteRecord, DocumentRecord } from '../db/schema';
import { normalizeTitle } from '../utils/documentDeduplication';

export interface RepairResult {
  repairedCount: number;
  details: string[];
}

/**
 * Normalizes a note header or title for matching.
 * e.g. "# Notes for Attention Is All You Need" -> "Attention Is All You Need"
 */
export function extractIntendedTitleFromNote(note: NoteRecord): string | null {
  // 1. Try markdown heading 1: # Notes for <Title>
  const matchHeading = note.content.match(/^#\s*(?:Notes\s+(?:for|zu|on|f\u00fcr)\s+)?([^\n\r]+)/im);
  if (matchHeading && matchHeading[1]) {
    const raw = matchHeading[1].trim();
    if (raw.length >= 3 && !raw.toLowerCase().startsWith('key insights')) {
      return raw;
    }
  }

  // 2. Try note.title: Notes for <Title>
  if (note.title) {
    const raw = note.title.replace(/^(?:Notes\s+(?:for|zu|on|f\u00fcr)\s+)/i, '').trim();
    if (raw.length >= 3) {
      return raw;
    }
  }

  return null;
}

/**
 * Scans all notes in IndexedDB and repairs mislinked documentId references.
 * Fixes cross-contamination caused by component unmount race conditions.
 */
export async function repairMislinkedNotes(): Promise<RepairResult> {
  const allNotes = await db.notes.toArray();
  const allDocs = await db.documents.toArray();
  const details: string[] = [];
  let repairedCount = 0;

  if (allNotes.length === 0 || allDocs.length === 0) {
    return { repairedCount: 0, details: [] };
  }

  const docById = new Map<string, DocumentRecord>(allDocs.map((d) => [d.id, d]));

  for (const note of allNotes) {
    const currentDoc = docById.get(note.documentId);
    const intendedTitle = extractIntendedTitleFromNote(note);

    if (!intendedTitle) continue;

    const normIntended = normalizeTitle(intendedTitle);
    if (!normIntended || normIntended.length < 5) continue;

    // Check if the note already belongs to the correct document
    if (currentDoc) {
      const normCurrent = normalizeTitle(currentDoc.title);
      if (normCurrent === normIntended || normCurrent.includes(normIntended) || normIntended.includes(normCurrent)) {
        // Correct document, no repair needed for this note
        continue;
      }
    }

    // Note does NOT match currentDoc! Find the document that actually matches this note's intended title
    const matchingDoc = allDocs.find((d) => {
      const normDocTitle = normalizeTitle(d.title);
      return normDocTitle === normIntended || normDocTitle.includes(normIntended) || normIntended.includes(normDocTitle);
    });

    if (matchingDoc && matchingDoc.id !== note.documentId) {
      const oldTitle = currentDoc?.title || 'Unknown Doc';
      console.log(`[NoteRepair] Moving note "${note.title}" from "${oldTitle}" (${note.documentId}) to correct document "${matchingDoc.title}" (${matchingDoc.id})`);
      
      await db.notes.update(note.id, {
        documentId: matchingDoc.id,
        title: `Notes for ${matchingDoc.title}`,
        updatedAt: new Date(),
        syncUpdatedAt: Date.now(),
      });

      details.push(`Notiz "${intendedTitle}" von "${oldTitle}" nach "${matchingDoc.title}" verschoben`);
      repairedCount++;
    }
  }

  // Deduplicate empty stock notes if a document has multiple notes
  for (const doc of allDocs) {
    const docNotes = await db.notes.where('documentId').equals(doc.id).toArray();
    if (docNotes.length > 1) {
      // Find notes that have real custom user content
      const realNotes = docNotes.filter(
        (n) => n.content && !n.content.includes('Key insights and summary points from this study')
      );
      const stockNotes = docNotes.filter(
        (n) => n.content && n.content.includes('Key insights and summary points from this study')
      );

      // If we have at least one real note and some stock placeholder notes, remove the stock placeholders
      if (realNotes.length > 0 && stockNotes.length > 0) {
        for (const stock of stockNotes) {
          await db.notes.delete(stock.id);
          details.push(`Leere Platzhalter-Notiz f\u00fcr "${doc.title}" bereinigt`);
          repairedCount++;
        }
      }
    }
  }

  return { repairedCount, details };
}

export interface NoteDocPair {
  note: NoteRecord;
  doc: DocumentRecord | null;
}

/**
 * Holt alle Notizen inklusive ihres verknüpften Dokuments aus Dexie.
 */
export async function getAllNotesWithDocs(): Promise<NoteDocPair[]> {
  const notes = await db.notes.toArray();
  const docs = await db.documents.toArray();
  const docMap = new Map(docs.map((d) => [d.id, d]));

  return notes.map((note) => ({
    note,
    doc: docMap.get(note.documentId) || null,
  }));
}

/**
 * Überträgt oder tauscht Notizen zwischen zwei Dokumenten.
 * Passt documentId, Notiz-Titel und Header-Zeile (# Notes for ...) sauber an.
 */
export async function reassignOrSwapNote(
  sourceDocId: string,
  targetDocId: string,
  swap: boolean = true
): Promise<{ success: boolean; message: string }> {
  const sourceDoc = await db.documents.get(sourceDocId);
  const targetDoc = await db.documents.get(targetDocId);

  if (!sourceDoc || !targetDoc) {
    return { success: false, message: 'Dokument nicht gefunden' };
  }

  const sourceNotes = await db.notes.where('documentId').equals(sourceDocId).toArray();
  const targetNotes = await db.notes.where('documentId').equals(targetDocId).toArray();

  const sourceNote = sourceNotes.find(n => n.content && !n.content.includes('Key insights and summary points from this study')) || sourceNotes[0];
  const targetNote = targetNotes.find(n => n.content && !n.content.includes('Key insights and summary points from this study')) || targetNotes[0];

  if (!sourceNote) {
    return { success: false, message: 'Keine Notiz für das Quelldokument vorhanden' };
  }

  // 1. Quell-Notiz auf Ziel-Dokument umschreiben
  let newSourceContent = sourceNote.content;
  if (sourceDoc.title && targetDoc.title) {
    newSourceContent = newSourceContent.replace(
      new RegExp(`^#\\s*(?:Notes\\s+(?:for|zu|on|f\u00fcr)\\s+)?[^\\n\\r]+`, 'im'),
      `# Notes for ${targetDoc.title}`
    );
  }

  await db.notes.update(sourceNote.id, {
    documentId: targetDocId,
    title: `Notes for ${targetDoc.title}`,
    content: newSourceContent,
    updatedAt: new Date(),
    syncUpdatedAt: Date.now(),
  });

  // 2. Falls Swap aktiviert und Ziel-Notiz existiert: Ziel-Notiz auf Quell-Dokument umschreiben
  if (swap && targetNote && targetNote.id !== sourceNote.id) {
    let newTargetContent = targetNote.content;
    if (sourceDoc.title && targetDoc.title) {
      newTargetContent = newTargetContent.replace(
        new RegExp(`^#\\s*(?:Notes\\s+(?:for|zu|on|f\u00fcr)\\s+)?[^\\n\\r]+`, 'im'),
        `# Notes for ${sourceDoc.title}`
      );
    }

    await db.notes.update(targetNote.id, {
      documentId: sourceDocId,
      title: `Notes for ${sourceDoc.title}`,
      content: newTargetContent,
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    });
  }

  return {
    success: true,
    message: swap && targetNote && targetNote.id !== sourceNote.id
      ? `Notizen zwischen "${sourceDoc.title}" und "${targetDoc.title}" erfolgreich getauscht!`
      : `Notiz erfolgreich zu "${targetDoc.title}" übertragen!`
  };
}
