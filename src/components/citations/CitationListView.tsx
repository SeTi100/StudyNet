import React, { useEffect, useState } from 'react';
import { db, CitationRecord } from '../../db/schema';
import { Bookmark, ExternalLink, Search, ArrowRightCircle } from 'lucide-react';

interface CitationListViewProps {
  documentId: string;
  onJumpToCitation?: (marker: string) => void;
}

export const CitationListView: React.FC<CitationListViewProps> = ({ documentId, onJumpToCitation }) => {
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);

    db.citations
      .where('documentId')
      .equals(documentId)
      .toArray()
      .then((records) => {
        if (isCurrent) {
          setCitations(records);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load citations:', err);
        if (isCurrent) setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [documentId]);

  const filtered = citations.filter(
    (c) =>
      c.marker.toLowerCase().includes(filter.toLowerCase()) ||
      c.title.toLowerCase().includes(filter.toLowerCase()) ||
      c.authors.some((a) => a.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col bg-neutral-900 border-l border-neutral-800">
      {/* Header */}
      <div className="p-3 border-b border-neutral-800 bg-neutral-950/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-neutral-200">
            Document Citations ({citations.length})
          </span>
        </div>
      </div>

      {/* Filter */}
      <div className="p-2.5 border-b border-neutral-800 bg-neutral-900">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter citations by marker, author or title..."
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="text-center py-8 text-neutral-500 text-xs animate-pulse">
            Loading citation database...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-neutral-500 text-xs">
            {citations.length === 0
              ? 'No citations recorded for this document yet.'
              : 'No matching citations found.'}
          </div>
        ) : (
          filtered.map((citation) => (
            <div
              key={`${citation.documentId}_${citation.marker}`}
              className="p-3 bg-neutral-950/80 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-colors group"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/60">
                  {citation.marker}
                </span>
                <div className="flex items-center gap-2">
                  {onJumpToCitation && (
                    <button
                      onClick={() => onJumpToCitation(citation.marker)}
                      className="text-neutral-400 hover:text-blue-400 transition-colors flex items-center gap-1 text-[11px]"
                      title="Jump to occurrence in document"
                    >
                      <ArrowRightCircle className="w-3.5 h-3.5" />
                      <span>Find in PDF</span>
                    </button>
                  )}
                  <a
                    href={`https://scholar.google.com/scholar?q=${encodeURIComponent(citation.title)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-400 hover:text-blue-400 transition-colors flex items-center gap-1 text-[11px]"
                    title="Search on Google Scholar"
                  >
                    <span>Scholar</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <div className="text-xs font-semibold text-neutral-200 leading-snug">
                {citation.title}
              </div>
              <div className="text-[11px] text-neutral-400 italic mt-1">
                {citation.authors?.join(', ')}
              </div>
              {citation.abstract && (
                <p className="text-[11px] text-neutral-400 mt-2 bg-neutral-900/60 p-2 rounded border border-neutral-800/80 leading-relaxed">
                  {citation.abstract}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
