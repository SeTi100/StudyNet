import React, { useEffect, useState } from 'react';
import { useViewerStore } from '../../store/useViewerStore';
import { db, CitationRecord } from '../../db/schema';
import { Bookmark, Copy, Check } from 'lucide-react';

const citationCache = new Map<string, CitationRecord>();

export const CitationTooltip: React.FC<{
  documentId: string;
  onJumpToReferences?: (marker: string) => void;
}> = ({ documentId, onJumpToReferences }) => {
  const marker = useViewerStore((state) => state.activeCitationMarker);
  const position = useViewerStore((state) => state.hoverPosition);
  const [data, setData] = useState<CitationRecord | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!marker) {
      setData(null);
      return;
    }

    const cacheKey = `${documentId}_${marker}`;

    if (citationCache.has(cacheKey)) {
      setData(citationCache.get(cacheKey)!);
      return;
    }

    let isCurrent = true;

    db.citations.get([documentId, marker]).then((res) => {
      if (isCurrent && res) {
        citationCache.set(cacheKey, res);
        setData(res);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [marker, documentId]);

  if (!marker || !position || !data) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const citationText = `${data.marker} ${data.title}. ${data.authors?.join(', ')}.`;
    navigator.clipboard.writeText(citationText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed z-50 p-3 bg-neutral-900 text-white rounded-lg shadow-2xl border border-neutral-700 pointer-events-auto text-xs max-w-sm backdrop-blur-md bg-neutral-900/95 transition-opacity duration-150"
      style={{
        top: Math.min(position.y + 12, window.innerHeight - 200),
        left: Math.min(position.x + 12, window.innerWidth - 360),
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="font-mono font-bold text-blue-400 bg-blue-950/80 px-1.5 py-0.5 rounded border border-blue-800/60">
          {data.marker}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 flex items-center gap-1 transition-colors"
            title="Copy Citation"
          >
            {copied ? <Check className="w-2.5 h-2.5 text-green-400" /> : <Copy className="w-2.5 h-2.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          {onJumpToReferences && (
            <button
              onClick={() => onJumpToReferences(data.marker)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/60 hover:bg-blue-800 text-blue-200 flex items-center gap-1 transition-colors"
              title="Jump to Bibliography"
            >
              <Bookmark className="w-2.5 h-2.5" />
              <span>Bibliography</span>
            </button>
          )}
        </div>
      </div>
      <div className="font-semibold text-neutral-100 leading-snug">{data.title}</div>
      <div className="text-neutral-400 italic mt-0.5">{data.authors?.join(', ')}</div>
      {data.abstract && (
        <div className="text-neutral-300 text-[11px] mt-2 line-clamp-3 leading-relaxed border-t border-neutral-800 pt-1.5">
          {data.abstract}
        </div>
      )}
    </div>
  );
};
