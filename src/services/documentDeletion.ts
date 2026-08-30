import { db } from '../db/schema';
import { deleteFromOPFS } from '../utils/opfsStorage';

/**
 * Löscht ein Dokument vollständig inklusive aller abhängigen Datensätze.
 * 
 * Verwendet eine Dexie-Transaktion, um Atomarität zu garantieren:
 * Entweder werden ALLE verknüpften Daten gelöscht oder bei einem Fehler
 * wird die gesamte Operation zurückgerollt.
 * 
 * Löschkaskade:
 *   DocumentRecord → paperQuestions (Fragen + Vektoren)
 *                  → annotations (Hervorhebungen, Kommentare)
 *                  → notes (Notizen)
 *                  → citations (Zitationsreferenzen)
 *                  → OPFS PDF-Datei (außerhalb der DB-Transaktion)
 * 
 * @param documentId - Die UUID des zu löschenden Dokuments
 * @returns Statistik über gelöschte Datensätze
 */
export async function deleteDocumentCompletely(documentId: string): Promise<{
  questionsDeleted: number;
  annotationsDeleted: number;
  notesDeleted: number;
  citationsDeleted: number;
}> {
  let questionsDeleted = 0;
  let annotationsDeleted = 0;
  let notesDeleted = 0;
  let citationsDeleted = 0;

  // 1. Dexie Transaction (rw = read/write) – Atomare DB-Bereinigung
  await db.transaction(
    'rw',
    [db.documents, db.paperQuestions, db.annotations, db.notes, db.citations],
    async () => {
      // Alle abhängigen Fragen & Vektoren löschen
      questionsDeleted = await db.paperQuestions
        .where('documentId')
        .equals(documentId)
        .delete();

      // Alle Annotationen löschen
      annotationsDeleted = await db.annotations
        .where('documentId')
        .equals(documentId)
        .delete();

      // Alle Notizen löschen
      notesDeleted = await db.notes
        .where('documentId')
        .equals(documentId)
        .delete();

      // Alle Zitationen löschen
      citationsDeleted = await db.citations
        .where('documentId')
        .equals(documentId)
        .delete();

      // Das Dokument selbst löschen
      await db.documents.delete(documentId);
    }
  );

  // 2. OPFS-Bereinigung (außerhalb der DB-Transaktion, da Filesystem-Operationen
  //    nicht transaktional sind und ein Fehler hier die DB-Löschung nicht rückgängig machen soll)
  try {
    const doc = await db.documents.get(documentId);
    if (doc?.pdfOpfsPath && doc.pdfOpfsPath.startsWith('opfs://')) {
      await deleteFromOPFS(doc.pdfOpfsPath);
    }
  } catch (err) {
    // OPFS-Datei existierte nicht oder konnte nicht gelöscht werden – kein kritischer Fehler
    console.warn('[DocumentDeletion] OPFS-Bereinigung fehlgeschlagen (unkritisch):', err);
  }

  console.log(
    `[DocumentDeletion] Dokument ${documentId} gelöscht:`,
    `${questionsDeleted} Fragen, ${annotationsDeleted} Annotationen,`,
    `${notesDeleted} Notizen, ${citationsDeleted} Zitationen`
  );

  return { questionsDeleted, annotationsDeleted, notesDeleted, citationsDeleted };
}

/**
 * Löscht nur die generierten Fragen und Vektoren eines Dokuments.
 * Nützlich für Re-Analyse: Erst alte Fragen löschen, dann neu generieren.
 * 
 * @param documentId - Die UUID des Dokuments
 * @returns Anzahl gelöschter Fragen
 */
export async function deleteDocumentQuestions(documentId: string): Promise<number> {
  const deleted = await db.paperQuestions
    .where('documentId')
    .equals(documentId)
    .delete();

  console.log(`[DocumentDeletion] ${deleted} Fragen für Dokument ${documentId} gelöscht (Re-Analyse)`);
  return deleted;
}
