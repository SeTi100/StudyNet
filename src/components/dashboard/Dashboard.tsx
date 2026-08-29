import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '../../store/useDocumentStore';
import { openSourceFolder } from '../../utils/opfsStorage';
import { PaperCard } from './PaperCard';
import { RecentNotes } from './RecentNotes';
import { AnnotationFeed } from './AnnotationFeed';
import { FolderOpen, Plus, Search, Filter } from 'lucide-react';
import { db, DocumentRecord } from '../../db/schema';

export function Dashboard() {
  const { documents, loadDocuments, setFolderHandle, scanFolder } = useDocumentStore();
  const [filter, setFilter] = useState<'all' | 'recent' | 'tags'>('all');
  const [counts, setCounts] = useState<Record<string, { notes: number; annos: number }>>({});

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    async function loadCounts() {
      const newCounts: Record<string, { notes: number; annos: number }> = {};
      for (const doc of documents) {
        const notes = await db.notes.where('documentId').equals(doc.id).count();
        const annos = await db.annotations.where('documentId').equals(doc.id).count();
        newCounts[doc.id] = { notes, annos };
      }
      setCounts(newCounts);
    }
    if (documents.length > 0) {
      loadCounts();
    }
  }, [documents]);

  const handleSelectFolder = async () => {
    try {
      const handle = await openSourceFolder();
      setFolderHandle(handle);
      await scanFolder();
    } catch (err) {
      console.error('Failed to open folder:', err);
    }
  };

  const handleDocumentClick = (id: string) => {
    window.location.hash = `#doc=${id}`;
  };

  let displayedDocs = [...documents];
  if (filter === 'recent') {
    displayedDocs.sort((a, b) => {
      const timeA = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0;
      const timeB = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0;
      return timeB - timeA;
    });
  }

  return (
    <div className="flex h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden flex-col md:flex-row select-none">
      
      {/* Sidebar Desktop / Topbar Mobile */}
      <div className="w-full md:w-64 border-b md:border-r border-neutral-800 bg-neutral-950 flex flex-col shrink-0">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
          <h1 className="font-bold text-lg text-neutral-100 tracking-wide">StudyNet</h1>
          <button className="md:hidden p-2 text-neutral-400 hover:text-white">
            <Plus className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 space-y-2 hidden md:block">
          <button 
            onClick={handleSelectFolder}
            className="w-full py-2 px-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-neutral-200 text-xs font-medium rounded-lg flex items-center justify-center gap-2 transition-colors min-h-[44px]"
          >
            <FolderOpen className="w-4 h-4" />
            Ordner wählen
          </button>
        </div>

        {/* Filters */}
        <div className="p-2 md:p-4 flex md:flex-col gap-2 overflow-x-auto">
          <div className="md:hidden text-xs font-semibold text-neutral-500 uppercase flex items-center shrink-0 px-2">Filter:</div>
          <button 
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-left whitespace-nowrap min-h-[44px] ${filter === 'all' ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-400 hover:bg-neutral-900'}`}
          >
            Alle Dokumente
          </button>
          <button 
            onClick={() => setFilter('recent')}
            className={`px-4 py-2 text-sm font-medium rounded-lg text-left whitespace-nowrap min-h-[44px] ${filter === 'recent' ? 'bg-blue-600/20 text-blue-400' : 'text-neutral-400 hover:bg-neutral-900'}`}
          >
            Kürzlich gelesen
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-8">
          
          <div className="flex justify-between items-center md:hidden mb-4">
            <button 
              onClick={handleSelectFolder}
              className="py-2 px-4 bg-neutral-900 border border-neutral-700 text-neutral-200 text-sm font-medium rounded-lg flex items-center gap-2 min-h-[44px]"
            >
              <FolderOpen className="w-4 h-4" />
              Ordner wählen
            </button>
          </div>

          <div>
            <h2 className="text-xl font-bold mb-4">Deine Papers</h2>
            {displayedDocs.length === 0 ? (
              <div className="text-center py-12 bg-neutral-900/30 rounded-xl border border-neutral-800 border-dashed">
                <p className="text-neutral-500">Keine Dokumente gefunden.</p>
                <p className="text-xs text-neutral-600 mt-2">Wähle einen Ordner um PDFs zu importieren.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {displayedDocs.map(doc => (
                  <PaperCard 
                    key={doc.id}
                    document={doc}
                    annotationCount={counts[doc.id]?.annos || 0}
                    noteCount={counts[doc.id]?.notes || 0}
                    onClick={() => handleDocumentClick(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <RecentNotes />
            <AnnotationFeed />
          </div>

        </div>
      </div>
    </div>
  );
}
