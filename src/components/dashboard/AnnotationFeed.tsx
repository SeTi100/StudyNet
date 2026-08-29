import React, { useEffect, useState } from 'react';
import { db, AnnotationRecord } from '../../db/schema';
import { Edit3, ChevronRight } from 'lucide-react';

interface AnnotationWithDoc extends AnnotationRecord {
  docTitle?: string;
}

export function AnnotationFeed() {
  const [annotations, setAnnotations] = useState<AnnotationWithDoc[]>([]);

  useEffect(() => {
    async function load() {
      const recentAnnos = await db.annotations.orderBy('createdAt').reverse().limit(10).toArray();
      
      const withDocs = await Promise.all(
        recentAnnos.map(async (a) => {
          const doc = await db.documents.get(a.documentId);
          return { ...a, docTitle: doc?.title || 'Unknown Document' };
        })
      );
      
      setAnnotations(withDocs);
    }
    load();
  }, []);

  if (annotations.length === 0) return null;

  return (
    <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
        <Edit3 className="w-4 h-4 text-purple-400" />
        Letzte Markierungen
      </h3>
      <div className="space-y-2">
        {annotations.map((anno) => (
          <a
            key={anno.id}
            href={`#doc=${anno.documentId}&page=${anno.pageNumber}`}
            className="block p-3 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-purple-500/50 transition-colors group min-h-[44px]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-purple-400 truncate">
                  {anno.docTitle} (S.{anno.pageNumber})
                </div>
                {anno.selectedText && (
                  <div className="text-xs text-neutral-400 italic truncate mt-1">
                    "{anno.selectedText}"
                  </div>
                )}
                {anno.comment && (
                  <div className="text-xs text-neutral-300 mt-1 truncate">
                    {anno.comment}
                  </div>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-purple-400 shrink-0" />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
