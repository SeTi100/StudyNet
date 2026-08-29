import { useState } from 'react';

export interface SyncProvider {
  push: (records: any[]) => Promise<void>;
  pull: () => Promise<any[]>;
  resolveConflict: (local: any, remote: any) => any;
}

export class LocalOnlySyncProvider implements SyncProvider {
  async push(records: any[]): Promise<void> {
    // No-Op
  }

  async pull(): Promise<any[]> {
    // No-Op
    return [];
  }

  resolveConflict(local: any, remote: any): any {
    return local;
  }
}

// TODO Phase 4: Hier CouchDB/PouchDB oder Supabase-Adapter einsetzen

export function useSyncStatus() {
  const [isSyncing] = useState(false);
  const [lastSyncedAt] = useState<Date | null>(null);

  return { isSyncing, lastSyncedAt };
}
