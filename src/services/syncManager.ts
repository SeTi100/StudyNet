import { db, DocumentRecord, GeneratedQuestionRecord, AnnotationRecord, NoteRecord } from '../db/schema';
import { useSettingsStore } from '../store/useSettingsStore';

// URL des Sync-Servers (wird aus den Settings geladen)
const getSyncUrl = () => {
  const url = useSettingsStore.getState().syncServerUrl;
  return url || 'http://localhost:3000';
};

export class SyncManager {
  /**
   * Führt einen 2-Wege-Sync mit dem Server durch.
   */
  static async sync() {
    try {
      console.log('[SyncManager] Starte Synchronisation...');
      const lastSync = parseInt(localStorage.getItem('last_sync_timestamp') || '0', 10);
      const syncUrl = getSyncUrl();

      // 1. Lokale Änderungen sammeln (alles was NACH lastSync aktualisiert wurde)
      const dataToPush = {
        documents: await db.documents.where('syncUpdatedAt').above(lastSync).toArray(),
        generated_questions: await db.paperQuestions.where('syncUpdatedAt').above(lastSync).toArray(),
        annotations: await db.annotations.where('syncUpdatedAt').above(lastSync).toArray(),
        notes: await db.notes.where('syncUpdatedAt').above(lastSync).toArray()
      };

      const deletionsToPush = await db.deleted_records.where('deletedAt').above(lastSync).toArray();

      // 2. An den Server senden UND gleichzeitig neue Server-Daten erhalten
      const res = await fetch(`${syncUrl}/api/sync/push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: Date.now(),
          data: dataToPush,
          deletions: deletionsToPush
        })
      });

      if (!res.ok) throw new Error('Sync Push failed');
      const serverPushAck = await res.json();

      // 3. Änderungen vom Server abrufen
      const pullRes = await fetch(`${syncUrl}/api/sync/pull?since=${lastSync}`);
      if (!pullRes.ok) throw new Error('Sync Pull failed');
      const { data: serverData, deletions: serverDeletions, timestamp: serverTimestamp } = await pullRes.json();

      // 4. Server-Daten in lokale DB mergen
      await db.transaction('rw', [db.documents, db.paperQuestions, db.annotations, db.notes, db.deleted_records], async () => {
        
        // Deletions anwenden
        if (serverDeletions && serverDeletions.length > 0) {
          for (const del of serverDeletions) {
            if (del.tableName === 'documents') await db.documents.delete(del.id);
            if (del.tableName === 'generated_questions') await db.paperQuestions.delete(del.id);
            if (del.tableName === 'annotations') await db.annotations.delete(del.id);
            if (del.tableName === 'notes') await db.notes.delete(del.id);
            // Auch lokal als gelöscht markieren, damit wir es beim nächsten Sync ignorieren
            await db.deleted_records.put(del);
          }
        }

        // Upserts anwenden
        if (serverData.documents) await db.documents.bulkPut(serverData.documents);
        if (serverData.generated_questions) await db.paperQuestions.bulkPut(serverData.generated_questions);
        if (serverData.annotations) await db.annotations.bulkPut(serverData.annotations);
        if (serverData.notes) await db.notes.bulkPut(serverData.notes);
      });

      // 5. Zeitstempel aktualisieren
      // Wir nehmen den Timestamp vom Server, um Drift zu vermeiden
      localStorage.setItem('last_sync_timestamp', serverTimestamp.toString());
      console.log(`[SyncManager] Sync erfolgreich abgeschlossen! (Timestamp: ${serverTimestamp})`);
      
      return true;
    } catch (error) {
      console.error('[SyncManager] Fehler beim Synchronisieren:', error);
      return false;
    }
  }

  /**
   * Markiert einen Datensatz als gelöscht (wird vom UI aufgerufen)
   */
  static async recordDeletion(tableName: string, id: string) {
    await db.deleted_records.put({
      id,
      tableName,
      deletedAt: Date.now()
    });
  }
}
