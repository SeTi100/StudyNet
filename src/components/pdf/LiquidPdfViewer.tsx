import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { getFromOPFS } from '../../utils/opfsStorage';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useDocumentStore } from '../../store/useDocumentStore';
import { X, ZoomIn } from 'lucide-react';

interface LiquidPdfViewerProps {
  documentId: string;
  markdown: string;
  totalPages: number;
  initialPage?: number;
  initialPageRatio?: number;
  onPositionChange?: (page: number, pageRatio: number) => void;
}

// Module-level Blob URL cache to prevent image re-fetching and flickering on re-renders
const fluidImageCache = new Map<string, string>();

const FluidImage: React.FC<{ src?: string; alt?: string; documentId: string }> = React.memo(({ src, alt, documentId }) => {
  const cacheKey = `${documentId}:${src || ''}`;
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() => fluidImageCache.get(cacheKey) || null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    if (!src) return;
    
    // If already cached, no need to re-read from OPFS/Server
    if (fluidImageCache.has(cacheKey)) {
      setResolvedUrl(fluidImageCache.get(cacheKey)!);
      return;
    }

    let active = true;

    async function resolve() {
      if (!src) return;

      // 1. Extract clean filename (e.g. image_000000_...png)
      const fileName = src.split(/[\\/]/).pop()?.split('?')[0];

      // 2. Try loading from OPFS first (Offline-First)
      if (fileName) {
        try {
          const file = await getFromOPFS(`opfs://fluid_images/${fileName}`);
          if (!active) return;
          const objectUrl = URL.createObjectURL(file);
          fluidImageCache.set(cacheKey, objectUrl);
          setResolvedUrl(objectUrl);
          return;
        } catch (e) {
          // Not yet in OPFS, proceed to sync server fallback
        }
      }

      // 3. Fallback to Sync Server URL
      const syncUrl = useSettingsStore.getState().syncServerUrl;
      if (syncUrl && fileName) {
        const remoteUrl = `${syncUrl}/api/pdf/${documentId}/fluid/images/${fileName}`;
        if (active) {
          fluidImageCache.set(cacheKey, remoteUrl);
          setResolvedUrl(remoteUrl);
        }
        return;
      }

      // 4. Default raw src fallback
      if (active) {
        fluidImageCache.set(cacheKey, src);
        setResolvedUrl(src);
      }
    }

    resolve();

    return () => {
      active = false;
    };
  }, [src, documentId, cacheKey]);

  if (!src) return null;

  return (
    <>
      <span className="my-8 block text-center select-none group relative">
        {resolvedUrl ? (
          <span className="relative inline-block max-w-full">
            <img
              src={resolvedUrl}
              alt={alt || 'Figure from paper'}
              onClick={() => setIsFullscreen(true)}
              className="inline-block rounded-xl border border-neutral-700/80 bg-neutral-950/60 shadow-xl max-h-[750px] w-auto max-w-full object-contain mx-auto transition-transform hover:scale-[1.01] cursor-zoom-in"
            />
            <button
              onClick={() => setIsFullscreen(true)}
              className="absolute bottom-3 right-3 p-1.5 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 rounded-lg border border-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity shadow"
              title="Großansicht"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center justify-center min-h-[160px] w-full max-w-md p-6 text-xs text-neutral-500 bg-neutral-800/40 border border-neutral-800 rounded-xl animate-pulse mx-auto">
            Lade Abbildung in hoher Auflösung...
          </span>
        )}
        {alt && <span className="block text-xs text-neutral-400 mt-2.5 italic max-w-xl mx-auto leading-relaxed select-text">{alt}</span>}
      </span>

      {/* Fullscreen Zoom Modal */}
      {isFullscreen && resolvedUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200 select-none"
          onClick={() => setIsFullscreen(false)}
        >
          <button
            onClick={() => setIsFullscreen(false)}
            className="absolute top-5 right-5 p-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-600 transition-colors shadow-2xl"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={resolvedUrl}
            alt={alt || 'Figure Fullscreen'}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {alt && (
            <p className="text-neutral-300 text-xs mt-3 max-w-2xl text-center bg-neutral-900/90 px-4 py-2 rounded-lg border border-neutral-700 select-text">
              {alt}
            </p>
          )}
        </div>
      )}
    </>
  );
});

export const LiquidPdfViewer: React.FC<LiquidPdfViewerProps> = React.memo(({
  documentId,
  markdown,
  totalPages,
  initialPage = 1,
  initialPageRatio = 0,
  onPositionChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInitialScrollAppliedRef = useRef<boolean>(false);
  const lastTargetPageRef = useRef<number>(initialPage);
  const scrollDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const processedMarkdown = useMemo(() => markdown, [markdown]);

  // Synchronize initial scroll position from PDF Page / PageRatio
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Detect if the targetPage prop changed explicitly (e.g. outline click)
    const isExplicitJump = isInitialScrollAppliedRef.current && lastTargetPageRef.current !== initialPage;
    lastTargetPageRef.current = initialPage;

    const page = initialPage && initialPage >= 1 ? initialPage : 1;
    const ratio = typeof initialPageRatio === 'number' ? initialPageRatio : 0;
    const totalP = Math.max(1, totalPages);
    
    // Calculate global normalized progress (0.0 to 1.0)
    const globalRatio = Math.min(1, Math.max(0, (page - 1 + ratio) / totalP));

    const applyScroll = () => {
      if (!el) return;
      if (isInitialScrollAppliedRef.current && !isExplicitJump) return;
      
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll > 0) {
        el.scrollTop = Math.floor(globalRatio * maxScroll);
        isInitialScrollAppliedRef.current = true;
      }
    };

    // Apply scroll on mount, layout changes, or explicit jumps
    const frameId = requestAnimationFrame(applyScroll);
    const timer = setTimeout(applyScroll, 80);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timer);
    };
  }, [documentId, totalPages, initialPage, initialPageRatio, markdown]);

  // Cleanup scroll debounce on unmount
  useEffect(() => {
    return () => {
      if (scrollDebounceTimerRef.current) {
        clearTimeout(scrollDebounceTimerRef.current);
      }
    };
  }, []);

  // Track scroll position in Fluid Mode and synchronize with Document Store
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || !isInitialScrollAppliedRef.current) return;

    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    const scrollRatio = Math.min(1, Math.max(0, el.scrollTop / maxScroll));
    const totalP = Math.max(1, totalPages);

    // Map scroll percentage back to exact page + sub-page offset
    const exactProgress = scrollRatio * totalP;
    const rawPage = Math.floor(exactProgress) + 1;
    const page = Math.min(totalP, Math.max(1, rawPage));
    const subRatio = Math.min(1, Math.max(0, exactProgress - (page - 1)));
    const roundedRatio = Math.round(subRatio * 100) / 100;

    // Debounce the store update so scrolling is 100% silky smooth without triggering re-renders
    if (scrollDebounceTimerRef.current) {
      clearTimeout(scrollDebounceTimerRef.current);
    }

    scrollDebounceTimerRef.current = setTimeout(() => {
      // 1. Persist in Dexie & Zustand store
      useDocumentStore.getState().updateReadingProgress(documentId, page, roundedRatio);

      // 2. Notify parent reader (e.g. for URL hash)
      if (onPositionChange) {
        onPositionChange(page, roundedRatio);
      }
    }, 120);
  }, [documentId, totalPages, onPositionChange]);

  // Memoize markdown components to avoid destroying and re-mounting image/table DOM nodes on re-renders
  const markdownComponents = useMemo(() => ({
    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <FluidImage src={src} alt={alt} documentId={documentId} />
    ),
    p: ({ children }: { children?: React.ReactNode }) => (
      <div className="mb-5 leading-relaxed text-neutral-300 select-text">{children}</div>
    ),
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-8 border border-neutral-700/80 rounded-xl bg-neutral-950/40 shadow-lg select-text">
        <table className="min-w-full text-xs sm:text-sm divide-y divide-neutral-800 text-left border-collapse">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-neutral-800/80 text-neutral-100">{children}</thead>
    ),
    tbody: ({ children }: { children?: React.ReactNode }) => (
      <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/30">{children}</tbody>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-4 py-3 font-semibold text-neutral-200 border-b border-neutral-700 select-text">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-4 py-2.5 border-b border-neutral-800/40 text-neutral-300 select-text">{children}</td>
    ),
    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-2xl sm:text-3xl font-bold text-neutral-100 mt-10 mb-5 pb-2 border-b border-neutral-800 select-text">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-xl sm:text-2xl font-semibold text-neutral-100 mt-8 mb-4 select-text">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-lg font-semibold text-neutral-200 mt-6 mb-3 select-text">{children}</h3>
    ),
    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="list-disc pl-6 my-4 space-y-2 text-neutral-300 select-text">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="list-decimal pl-6 my-4 space-y-2 text-neutral-300 select-text">{children}</ol>
    ),
    code: ({ children }: { children?: React.ReactNode }) => (
      <code className="bg-neutral-800/90 text-blue-300 px-1.5 py-0.5 rounded text-xs font-mono select-text">
        {children}
      </code>
    ),
    pre: ({ children }: { children?: React.ReactNode }) => (
      <pre className="bg-neutral-950 border border-neutral-800 p-4 rounded-xl overflow-x-auto text-xs my-4 font-mono select-text shadow">
        {children}
      </pre>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2 select-text">
        {children}
      </a>
    )
  }), [documentId]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full w-full overflow-y-auto bg-neutral-900 text-neutral-200 p-6 sm:p-12 flex justify-center custom-scrollbar select-text cursor-text"
    >
      <div className="max-w-3xl w-full select-text pb-24">
        <div className="prose prose-invert prose-blue prose-sm sm:prose-base max-w-none text-neutral-300 select-text">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[[rehypeKatex, { strict: false, trust: true }]]}
            urlTransform={(url) => url}
            components={markdownComponents}
          >
            {processedMarkdown}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});
