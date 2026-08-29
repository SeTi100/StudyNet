import React, { useEffect, useState } from 'react';
import { db, NoteRecord } from '../../db/schema';
import { FileText, ChevronRight } from 'lucide-react';

interface NoteWithDoc extends NoteRecord {
  docTitle?: string;
}

export function RecentNotes() {
  const [notes, setNotes] = useState<NoteWithDoc[]>([]);

  useEffect(() => {
    async function load() {
      const recentNotes = await db.notes.orderBy('updatedAt').reverse().limit(10).toArray();
      
      const withDocs = await Promise.all(
        recentNotes.map(async (n) => {
          const doc = await db.documents.get(n.documentId);
          return { ...n, docTitle: doc?.title || 'Unknown Document' };
        })
      );
      
      setNotes(withDocs);
    }
    load();
  }, []);

  if (notes.length === 0) return null;

  return (
    <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4 text-blue-400" />
        Letzte Notizen
      </h3>
      <div className="space-y-2">
        {notes.map((note) => (
          <a
            key={note.id}
            href={`#doc=${note.documentId}${note.linkedPage ? `&page=${note.linkedPage}` : ''}`}
            className="block p-3 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-blue-500/50 transition-colors group min-h-[44px]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-blue-400 truncate">
                  {note.docTitle} {note.linkedPage && `(S.${note.linkedPage})`}
                </div>
                <div className="text-xs text-neutral-300 truncate mt-1">
                  {note.title || (note.content.substring(0, 40) + '...')}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-blue-400 shrink-0" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
