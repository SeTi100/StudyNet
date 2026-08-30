import React, { useEffect, useState } from 'react';
import { db, AnnotationRecord } from '../../db/schema';
import { Edit3, ChevronRight, Trash2 } from 'lucide-react';

interface AnnotationWithDoc extends AnnotationRecord {
  docTitle?: string;
}

export function AnnotationFeed() {
  const [annotations, setAnnotations] = useState<AnnotationWithDoc[]>([]);

  const loadAnnotations = async () => {
    const recentAnnos = await db.annotations.orderBy('createdAt').reverse().limit(10).toArray();
    
    const withDocs = await Promise.all(
      recentAnnos.map(async (a) => {
        const doc = await db.documents.get(a.documentId);
        return { ...a, docTitle: doc?.title || 'Unknown Document' };
      })
    );
    
    setAnnotations(withDocs);
  };

  useEffect(() => {
    loadAnnotations();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await db.annotations.delete(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Fehler beim Löschen:', err);
    }
  };

  if (annotations.length === 0) return null;

  return (
    <div className="bg-neutral-900/50 border border-neutral-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
        <Edit3 className="w-4 h-4 text-purple-400" />
        Letzte Markierungen
      </h3>
      <div className="space-y-2">
        {annotations.map((anno) => (
          <div
            key={anno.id}
            className="relative group block p-3 rounded-lg bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors min-h-[44px]"
          >
            <a
              href={`#doc=${anno.documentId}&page=${anno.pageNumber}`}
              className="flex items-center justify-between gap-2"
            >
              <div className="min-w-0 pr-8">
                <div className="flex items-center gap-1.5 text-xs font-medium text-purple-400 truncate">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                    style={{ backgroundColor: anno.color }}
                  />
                  <span>{anno.docTitle} (S.{anno.pageNumber})</span>
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
            </a>
            <button
              onClick={(e) => handleDelete(anno.id, e)}
              className="absolute top-2.5 right-8 opacity-0 group-hover:opacity-100 p-1 rounded-md text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-all"
              title="Markierung löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
