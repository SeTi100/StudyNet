import { db, DocumentRecord, GeneratedQuestionRecord, AnnotationRecord, NoteRecord } from '../db/schema';
import { useSettingsStore } from '../store/useSettingsStore';
import { saveToOPFS, getFromOPFS } from '../utils/opfsStorage';

// URL des Sync-Servers (wird aus den Settings geladen)
const getSyncUrl = () => {
  const url = useSettingsStore.getState().syncServerUrl;
  return url || 'http://localhost:3000';
};

export class SyncManager {
  /**
   * Führt einen vollständigen 2-Wege-Sync mit dem Server durch.
   */
  static async sync() {
    try {
      console.log('[SyncManager] Starte Synchronisation...');
      const lastSync = parseInt(localStorage.getItem('last_sync_timestamp') || '0', 10);
      const syncUrl = getSyncUrl();
      const now = Date.now();

      // 1. Alle lokalen Einträge laden und fehlende syncUpdatedAt nachpflegen
      const allDocs = await db.documents.toArray();
      const allQuestions = await db.paperQuestions.toArray();
      const allAnnotations = await db.annotations.toArray();
      const allNotes = await db.notes.toArray();
      const allDeletions = await db.deleted_records.toArray();

      // Fehlende Zeitstempel sofort reparieren
      for (const d of allDocs) {
        if (!d.syncUpdatedAt) {
          d.syncUpdatedAt = now;
          await db.documents.put(d);
        }
      }
      for (const q of allQuestions) {
        if (!q.syncUpdatedAt) {
          q.syncUpdatedAt = now;
          await db.paperQuestions.put(q);
        }
      }
      for (const a of allAnnotations) {
        if (!a.syncUpdatedAt) {
          a.syncUpdatedAt = now;
          await db.annotations.put(a);
        }
      }
      for (const n of allNotes) {
        if (!n.syncUpdatedAt) {
          n.syncUpdatedAt = now;
          await db.notes.put(n);
        }
      }

      // Änderungen filtern (alles was seit lastSync neu/bearbeitet ist)
      const docsToPush = allDocs.filter(d => (d.syncUpdatedAt || 0) > lastSync);
      const questionsToPush = allQuestions.filter(q => (q.syncUpdatedAt || 0) > lastSync);
      const annotationsToPush = allAnnotations.filter(a => (a.syncUpdatedAt || 0) > lastSync);
      const notesToPush = allNotes.filter(n => (n.syncUpdatedAt || 0) > lastSync);
      const deletionsToPush = allDeletions.filter(del => del.deletedAt > lastSync);

      console.log(`[SyncManager] Sende lokale Änderungen: ${docsToPush.length} Papers, ${questionsToPush.length} Fragen...`);

      // 2. Metadaten & Datensätze an den Server senden
      const pushRes = await fetch(`${syncUrl}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: now,
          data: {
            documents: docsToPush,
            generated_questions: questionsToPush,
            annotations: annotationsToPush,
            notes: notesToPush
          },
          deletions: deletionsToPush
        })
      });

      if (!pushRes.ok) throw new Error(`Sync Push failed: ${pushRes.statusText}`);

      // 3. Physische PDF-Dateien für neue/aktualisierte Dokumente hochladen
      for (const doc of docsToPush) {
        try {
          if (doc.pdfOpfsPath) {
            const pdfFile = await getFromOPFS(doc.pdfOpfsPath);
            const formData = new FormData();
            formData.append('file', pdfFile);

            console.log(`[SyncManager] Lade PDF hoch: ${doc.title} (${doc.id})`);
            await fetch(`${syncUrl}/api/pdf/${doc.id}`, {
              method: 'POST',
              body: formData
            });
          }
        } catch (pdfErr) {
          console.warn(`[SyncManager] Konnte PDF für Doc ${doc.id} nicht hochladen:`, pdfErr);
        }
      }

      // 4. Änderungen vom Server abrufen
      const pullRes = await fetch(`${syncUrl}/api/sync/pull?since=${lastSync}`);
      if (!pullRes.ok) throw new Error(`Sync Pull failed: ${pullRes.statusText}`);
      const { data: serverData, deletions: serverDeletions, timestamp: serverTimestamp } = await pullRes.json();

      console.log(`[SyncManager] Empfangen vom Server: ${serverData.documents?.length || 0} Papers, ${serverData.generated_questions?.length || 0} Fragen...`);

      // 5. Server-Daten in lokale IndexedDB einpflegen
      await db.transaction('rw', [db.documents, db.paperQuestions, db.annotations, db.notes, db.deleted_records], async () => {
        // Deletions
        if (serverDeletions && serverDeletions.length > 0) {
          for (const del of serverDeletions) {
            if (del.tableName === 'documents') await db.documents.delete(del.id);
            if (del.tableName === 'generated_questions') await db.paperQuestions.delete(del.id);
            if (del.tableName === 'annotations') await db.annotations.delete(del.id);
            if (del.tableName === 'notes') await db.notes.delete(del.id);
            await db.deleted_records.put(del);
          }
        }

        // Upserts
        if (serverData.documents) await db.documents.bulkPut(serverData.documents);
        if (serverData.generated_questions) await db.paperQuestions.bulkPut(serverData.generated_questions);
        if (serverData.annotations) await db.annotations.bulkPut(serverData.annotations);
        if (serverData.notes) await db.notes.bulkPut(serverData.notes);
      });

      // 6. Fehlende PDFs vom Server ins lokale OPFS herunterladen
      if (serverData.documents && serverData.documents.length > 0) {
        for (const doc of serverData.documents) {
          try {
            // Prüfen, ob Datei lokal im OPFS schon existiert
            let exists = false;
            try {
              if (doc.pdfOpfsPath) {
                await getFromOPFS(doc.pdfOpfsPath);
                exists = true;
              }
            } catch (e) {
              exists = false;
            }

            if (!exists) {
              console.log(`[SyncManager] Lade fehlende PDF vom Server herunter: ${doc.title}`);
              const fileRes = await fetch(`${syncUrl}/api/pdf/${doc.id}`);
              if (fileRes.ok) {
                const blob = await fileRes.blob();
                const savedPath = await saveToOPFS(blob, 'pdfs', `${doc.id}.pdf`);
                // OPFS Pfad aktualisieren, falls abweichend
                if (doc.pdfOpfsPath !== savedPath) {
                  doc.pdfOpfsPath = savedPath;
                  await db.documents.put(doc);
                }
              }
            }
          } catch (dlErr) {
            console.error(`[SyncManager] Fehler beim Download der PDF für ${doc.title}:`, dlErr);
          }
        }
      }

      // 7. Zeitstempel speichern
      localStorage.setItem('last_sync_timestamp', serverTimestamp.toString());
      console.log(`[SyncManager] Synchronisation vollständig! (Neuer Timestamp: ${serverTimestamp})`);
      
      return true;
    } catch (error) {
      console.error('[SyncManager] Fehler bei der Synchronisation:', error);
      return false;
    }
  }

  /**
   * Setzt den lokalen Sync-Timestamp zurück (zwingt einen vollständigen Re-Sync)
   */
  static resetSyncTimestamp() {
    localStorage.removeItem('last_sync_timestamp');
  }

  /**
   * Markiert einen Datensatz als gelöscht
   */
  static async recordDeletion(tableName: string, id: string) {
    await db.deleted_records.put({
      id,
      tableName,
      deletedAt: Date.now()
    });
  }
}
