import { db, DocumentRecord, NoteRecord, AnnotationRecord, GeneratedQuestionRecord, CitationRecord } from '../db/schema';
import { useSemanticSearchStore } from '../store/useSemanticSearchStore';
import { useDocumentStore } from '../store/useDocumentStore';

export interface StudyNetBackupFile {
  version: 1;
  exportedAt: string;
  app: 'StudyNet';
  documents: DocumentRecord[];
  notes: NoteRecord[];
  annotations: AnnotationRecord[];
  paperQuestions: GeneratedQuestionRecord[];
  citations: CitationRecord[];
}

export interface ImportResult {
  matchedDocumentsCount: number;
  unmatchedDocumentsCount: number;
  importedQuestionsCount: number;
  importedNotesCount: number;
  importedAnnotationsCount: number;
  importedCitationsCount: number;
}

/**
 * Normalisiert einen Titel oder DOI für robusten Abgleich.
 */
function normalizeString(str?: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Exportiert die gesamte Datenbank (Dokument-Metadaten, Notizen, Markierungen,
 * KI-generierte Fragen inkl. Embeddings und Zitationen) als JSON-Datei.
 */
export async function exportDatabaseBackup(): Promise<void> {
  const [documents, notes, annotations, paperQuestions, citations] = await Promise.all([
    db.documents.toArray(),
    db.notes.toArray(),
    db.annotations.toArray(),
    db.paperQuestions.toArray(),
    db.citations.toArray(),
  ]);

  const backupData: StudyNetBackupFile = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'StudyNet',
    documents,
    notes,
    annotations,
    paperQuestions,
    citations,
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `studynet-backup-${dateStr}.json`;

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Importiert ein zuvor exportiertes Backup und verknüpft Fragen, Notizen
 * und Annotationen intelligent via DOI, Dateipfad oder Titel mit den aktuellen Papers.
 */
export async function importDatabaseBackup(file: File): Promise<ImportResult> {
  const text = await file.text();
  let backupData: StudyNetBackupFile;

  try {
    backupData = JSON.parse(text);
  } catch {
    throw new Error('Die ausgewählte Datei ist kein gültiges JSON.');
  }

  if (backupData.app !== 'StudyNet' || !Array.isArray(backupData.documents)) {
    throw new Error('Ungültiges Backup-Format. Bitte eine von StudyNet erstellte Backup-Datei wählen.');
  }

  const currentDocs = await db.documents.toArray();

  // Mapping: alter documentId (aus Backup) -> neuer documentId (in aktueller DB)
  const docIdMap = new Map<string, string>();

  let matchedDocumentsCount = 0;
  let unmatchedDocumentsCount = 0;

  for (const backupDoc of backupData.documents) {
    const backupDoi = normalizeString(backupDoc.doi);
    const backupPath = (backupDoc.folderRelativePath || '').trim().toLowerCase();
    const backupTitle = normalizeString(backupDoc.title);

    // 1. Suche nach passendem Dokument in der aktuellen Datenbank
    const matched = currentDocs.find((doc) => {
      // A. Match per DOI
      if (backupDoi && doc.doi && normalizeString(doc.doi) === backupDoi) {
        return true;
      }
      // B. Match per Ordnerpfad
      if (backupPath && doc.folderRelativePath && doc.folderRelativePath.trim().toLowerCase() === backupPath) {
        return true;
      }
      // C. Match per Titel (mind. 5 Zeichen)
      if (backupTitle.length >= 5 && doc.title && normalizeString(doc.title) === backupTitle) {
        return true;
      }
      // D. Match per ID
      if (doc.id === backupDoc.id) {
        return true;
      }
      return false;
    });

    if (matched) {
      docIdMap.set(backupDoc.id, matched.id);
      matchedDocumentsCount++;

      // Optional: Lesefortschritt aktualisieren, falls im Backup mehr gelesene Seiten waren
      const currentRead = matched.readPages || [];
      const backupRead = backupDoc.readPages || [];
      const mergedRead = Array.from(new Set([...currentRead, ...backupRead])).sort((a, b) => a - b);

      await db.documents.update(matched.id, {
        readPages: mergedRead,
        isCompleted: matched.isCompleted || backupDoc.isCompleted,
        bibliographyStartPage: matched.bibliographyStartPage || backupDoc.bibliographyStartPage,
      });
    } else {
      // Wenn das Dokument in der aktuellen DB noch nicht existiert (z.B. vor erneutem Ordner-Scan):
      // Dokument aus Backup als Eintrag wiederherstellen
      await db.documents.put(backupDoc);
      docIdMap.set(backupDoc.id, backupDoc.id);
      unmatchedDocumentsCount++;
    }
  }

  // ── Fragen (Analysen) importieren ─────────────────────────────────────────
  let importedQuestionsCount = 0;
  if (Array.isArray(backupData.paperQuestions) && backupData.paperQuestions.length > 0) {
    const existingQuestions = await db.paperQuestions.toArray();
    const existingQSet = new Set(existingQuestions.map((q) => `${q.documentId}___${q.question}`));

    const questionsToInsert: GeneratedQuestionRecord[] = [];
    for (const q of backupData.paperQuestions) {
      const targetDocId = docIdMap.get(q.documentId) || q.documentId;
      const key = `${targetDocId}___${q.question}`;

      if (!existingQSet.has(key)) {
        existingQSet.add(key);
        questionsToInsert.push({
          ...q,
          id: crypto.randomUUID(),
          documentId: targetDocId,
          createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
        });
      }
    }

    if (questionsToInsert.length > 0) {
      await db.paperQuestions.bulkAdd(questionsToInsert);
      importedQuestionsCount = questionsToInsert.length;
    }
  }

  // ── Notizen importieren ───────────────────────────────────────────────────
  let importedNotesCount = 0;
  if (Array.isArray(backupData.notes) && backupData.notes.length > 0) {
    const existingNotes = await db.notes.toArray();
    const notesToPut: NoteRecord[] = [];

    for (const note of backupData.notes) {
      const targetDocId = docIdMap.get(note.documentId) || note.documentId;
      const existing = existingNotes.find((n) => n.documentId === targetDocId);

      if (!existing) {
        notesToPut.push({
          ...note,
          id: crypto.randomUUID(),
          documentId: targetDocId,
          createdAt: note.createdAt ? new Date(note.createdAt) : new Date(),
          updatedAt: note.updatedAt ? new Date(note.updatedAt) : new Date(),
        });
      } else if (note.content && note.content !== existing.content) {
        // Falls Notiz existiert, aber Backup-Inhalt anders ist: anhängen oder aktualisieren
        const mergedContent = `${existing.content}\n\n---\n*Importierte Notiz vom ${new Date().toLocaleDateString()}:*\n${note.content}`;
        await db.notes.update(existing.id, {
          content: mergedContent,
          updatedAt: new Date(),
        });
      }
    }

    if (notesToPut.length > 0) {
      await db.notes.bulkAdd(notesToPut);
      importedNotesCount = notesToPut.length;
    }
  }

  // ── Markierungen (Annotations) importieren ────────────────────────────────
  let importedAnnotationsCount = 0;
  if (Array.isArray(backupData.annotations) && backupData.annotations.length > 0) {
    const existingAnnos = await db.annotations.toArray();
    const existingAnnoSet = new Set(
      existingAnnos.map((a) => `${a.documentId}_${a.pageNumber}_${a.type}_${a.selectedText || ''}`)
    );

    const annosToInsert: AnnotationRecord[] = [];
    for (const anno of backupData.annotations) {
      const targetDocId = docIdMap.get(anno.documentId) || anno.documentId;
      const key = `${targetDocId}_${anno.pageNumber}_${anno.type}_${anno.selectedText || ''}`;

      if (!existingAnnoSet.has(key)) {
        existingAnnoSet.add(key);
        annosToInsert.push({
          ...anno,
          id: crypto.randomUUID(),
          documentId: targetDocId,
          createdAt: anno.createdAt ? new Date(anno.createdAt) : new Date(),
          updatedAt: anno.updatedAt ? new Date(anno.updatedAt) : new Date(),
        });
      }
    }

    if (annosToInsert.length > 0) {
      await db.annotations.bulkAdd(annosToInsert);
      importedAnnotationsCount = annosToInsert.length;
    }
  }

  // ── Zitationen importieren ────────────────────────────────────────────────
  let importedCitationsCount = 0;
  if (Array.isArray(backupData.citations) && backupData.citations.length > 0) {
    const citationsToPut: CitationRecord[] = [];
    for (const cit of backupData.citations) {
      const targetDocId = docIdMap.get(cit.documentId) || cit.documentId;
      citationsToPut.push({
        ...cit,
        documentId: targetDocId,
      });
    }

    if (citationsToPut.length > 0) {
      await db.citations.bulkPut(citationsToPut);
      importedCitationsCount = citationsToPut.length;
    }
  }

  // ── Stores aktualisieren & Such-Index neu aufbauen ─────────────────────────
  await useDocumentStore.getState().loadDocuments();
  try {
    await useSemanticSearchStore.getState().initializeSearch();
  } catch (err) {
    console.warn('Suche nach Import neu initialisieren fehlgeschlagen:', err);
  }

  return {
    matchedDocumentsCount,
    unmatchedDocumentsCount,
    importedQuestionsCount,
    importedNotesCount,
    importedAnnotationsCount,
    importedCitationsCount,
  };
}
