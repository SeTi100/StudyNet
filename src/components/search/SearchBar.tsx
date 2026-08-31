import React, { useState, useEffect, useMemo, useRef } from 'react';
import MiniSearch from 'minisearch';
import { Search, X, ChevronRight, FileText } from 'lucide-react';

interface SearchBarProps {
  searchIndexJson: string | null;
  pageTexts?: Record<number, string>;
  onSelectPage: (pageNumber: number) => void;
}

interface SearchResultItem {
  id: string;
  pageNumber: number;
  snippet: string;
  score: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchIndexJson,
  pageTexts = {},
  onSelectPage,
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCompactExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCompactExpanded]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        if (!query.trim()) {
          setIsCompactExpanded(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [query]);

  const miniSearch = useMemo(() => {
    if (!searchIndexJson) return null;
    try {
      return MiniSearch.loadJSON(searchIndexJson, {
        fields: ['text'],
        storeFields: ['pageNumber', 'text', 'documentId'],
        searchOptions: {
          boost: { text: 1 },
          fuzzy: 0.2,
          prefix: true,
        },
      });
    } catch (e) {
      console.error('Failed to load MiniSearch index:', e);
      return null;
    }
  }, [searchIndexJson]);

  const results = useMemo<SearchResultItem[]>(() => {
    if (!query.trim()) return [];

    if (miniSearch) {
      try {
        const searchResults = miniSearch.search(query.trim());
        return searchResults.slice(0, 10).map((res: any) => {
          const fullText = pageTexts[res.pageNumber] || res.text || '';
          const qIndex = fullText.toLowerCase().indexOf(query.toLowerCase());
          let snippet = '';
          if (qIndex !== -1) {
            const start = Math.max(0, qIndex - 40);
            const end = Math.min(fullText.length, qIndex + query.length + 60);
            snippet = (start > 0 ? '...' : '') + fullText.substring(start, end).trim() + (end < fullText.length ? '...' : '');
          } else {
            snippet = fullText.substring(0, 100) + '...';
          }

          return {
            id: res.id,
            pageNumber: res.pageNumber,
            snippet,
            score: res.score,
          };
        });
      } catch (err) {
        console.error('Search error:', err);
      }
    }

    // Fallback simple search across pageTexts
    const fallbackResults: SearchResultItem[] = [];
    const lowerQuery = query.toLowerCase();
    for (const [pageNumStr, text] of Object.entries(pageTexts)) {
      const pageNum = parseInt(pageNumStr, 10);
      const idx = text.toLowerCase().indexOf(lowerQuery);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 60);
        const snippet = (start > 0 ? '...' : '') + text.substring(start, end).trim() + (end < text.length ? '...' : '');
        fallbackResults.push({
          id: `page_${pageNum}`,
          pageNumber: pageNum,
          snippet,
          score: 1,
        });
      }
    }

    return fallbackResults.slice(0, 10);
  }, [query, miniSearch, pageTexts]);

  return (
    <div ref={containerRef} className="relative">
      {/* Compact Mode: Square Button when space is limited (< lg) and not expanded */}
      {!isCompactExpanded && !query && (
        <button
          onClick={() => {
            setIsCompactExpanded(true);
            setIsOpen(true);
          }}
          className="lg:hidden px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-center border border-neutral-800 bg-neutral-900 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-all shrink-0"
          title="Dokument durchsuchen"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Expanded / Large-Screen Search Input */}
      <div
        className={`${
          isCompactExpanded || query ? 'flex' : 'hidden lg:flex'
        } relative items-center w-48 sm:w-60 lg:w-48 xl:w-72 transition-all`}
      >
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-neutral-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Dokument durchsuchen..."
          className="w-full bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder-neutral-500 text-xs rounded-lg pl-8 pr-7 py-1.5 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
        />
        {(query || isCompactExpanded) && (
          <button
            onClick={() => {
              setQuery('');
              setIsOpen(false);
              setIsCompactExpanded(false);
            }}
            className="absolute right-2 text-neutral-400 hover:text-neutral-200 p-0.5"
            title="Schließen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && query.trim().length > 0 && (
        <div className="absolute top-full right-0 lg:left-0 lg:right-auto mt-1.5 w-72 sm:w-80 md:w-96 bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 max-h-72 overflow-y-auto">
          <div className="p-2 border-b border-neutral-800 flex justify-between items-center text-[11px] text-neutral-400">
            <span>{results.length} Ergebnisse gefunden</span>
            <button
              onClick={() => {
                setIsOpen(false);
                if (!query.trim()) setIsCompactExpanded(false);
              }}
              className="hover:text-neutral-200"
            >
              Schließen
            </button>
          </div>

          {results.length === 0 ? (
            <div className="p-4 text-center text-xs text-neutral-500">
              Keine Treffer für &quot;{query}&quot;
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {results.map((res) => (
                <button
                  key={res.id}
                  onClick={() => {
                    onSelectPage(res.pageNumber);
                    setIsOpen(false);
                  }}
                  className="w-full text-left p-2.5 hover:bg-neutral-800/80 transition-colors flex items-start gap-2.5 group"
                >
                  <div className="mt-0.5 p-1 rounded bg-blue-950/70 border border-blue-800/40 text-blue-400">
                    <FileText className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-200 group-hover:text-blue-400">
                        Seite {res.pageNumber}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-500 group-hover:text-neutral-300" />
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-1 line-clamp-2 leading-relaxed">
                      {res.snippet}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
