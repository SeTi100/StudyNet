import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { CitationOverlayLayer } from './CitationOverlayLayer';
import { AnnotationOverlayLayer } from './AnnotationOverlayLayer';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';
import { db, AnnotationRecord } from '../../db/schema';
import { useLiveQuery } from 'dexie-react-hooks';
import { useViewerStore } from '../../store/useViewerStore';

interface TextItemData {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LinkAnnotationData {
  rect: { x: number; y: number; w: number; h: number };
  destPageNum: number;
  rawAnno?: any;
}

export interface SelectionData {
  text: string;
  rects: { x: number; y: number; w: number; h: number }[];
  page: number;
}

interface PdfPageItemProps {
  documentId: string;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  containerWidth: number;
  pageHitboxes: CitationHitbox[];
  isSnipMode?: boolean;
  onSnipComplete?: (blob: Blob, pageNumber: number) => void;
  onCitationClick?: (marker: string, targetPage?: number, sourcePage?: number) => void;
  onTextSelected?: (selection: SelectionData) => void;
}

export const PdfPageItem: React.FC<PdfPageItemProps> = ({
  documentId,
  pdfDocument,
  pageNumber,
  containerWidth,
  pageHitboxes,
  isSnipMode = false,
  onSnipComplete,
  onCitationClick,
  onTextSelected,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [textItems, setTextItems] = useState<TextItemData[]>([]);
  const [linkItems, setLinkItems] = useState<LinkAnnotationData[]>([]);
  const pageRef = useRef<pdfjsLib.PDFPageProxy | null>(null);

  const annotations = useLiveQuery(
    () => db.annotations.where('documentId').equals(documentId).and(a => a.pageNumber === pageNumber).toArray(),
    [documentId, pageNumber]
  );

  const passageHighlight = useViewerStore((s) => s.passageHighlight);
  const setPassageHighlight = useViewerStore((s) => s.setPassageHighlight);

  // Calculate matching bounding rects for passage search highlight
  const highlightRects = useMemo(() => {
    if (!passageHighlight || passageHighlight.pageNumber !== pageNumber || textItems.length === 0) {
      return [];
    }

    // 1. Tokenize & normalize passage text into words
    const targetWords = passageHighlight.text
      .split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((w) => w.length > 0);

    if (targetWords.length === 0) return [];

    // 2. Tokenize & normalize page text items with mapping
    interface WordEntry {
      word: string;
      item: TextItemData;
      itemIdx: number;
    }

    const pageWords: WordEntry[] = [];
    textItems.forEach((item, itemIdx) => {
      const words = item.str.split(/\s+/);
      for (const w of words) {
        const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (norm.length > 0) {
          pageWords.push({ word: norm, item, itemIdx });
        }
      }
    });

    if (pageWords.length === 0) return [];

    // 3. Find all matching word runs between targetWords and pageWords
    interface MatchingRun {
      targetStart: number;
      targetEnd: number;
      pageStart: number;
      pageEnd: number;
      length: number;
    }

    const runs: MatchingRun[] = [];

    for (let p = 0; p < pageWords.length; p++) {
      for (let t = 0; t < targetWords.length; t++) {
        if (pageWords[p].word === targetWords[t]) {
          let len = 1;
          while (
            p + len < pageWords.length &&
            t + len < targetWords.length &&
            pageWords[p + len].word === targetWords[t + len]
          ) {
            len++;
          }

          if (len >= 2) {
            runs.push({
              targetStart: t,
              targetEnd: t + len - 1,
              pageStart: p,
              pageEnd: p + len - 1,
              length: len,
            });
          }
        }
      }
    }

    const matchedItemIndices = new Set<number>();

    if (runs.length > 0) {
      // Sort runs by page position
      runs.sort((a, b) => a.pageStart - b.pageStart);

      // Merge runs that belong to the same paragraph/passage (distance <= 25 words)
      interface MergedSpan {
        pageStart: number;
        pageEnd: number;
        totalMatchedWords: number;
      }

      const mergedSpans: MergedSpan[] = [];
      for (const run of runs) {
        const last = mergedSpans[mergedSpans.length - 1];
        if (last && run.pageStart <= last.pageEnd + 25) {
          last.pageEnd = Math.max(last.pageEnd, run.pageEnd);
          last.totalMatchedWords += run.length;
        } else {
          mergedSpans.push({
            pageStart: run.pageStart,
            pageEnd: run.pageEnd,
            totalMatchedWords: run.length,
          });
        }
      }

      // Pick spans with meaningful match density (at least 3 words total)
      const validSpans = mergedSpans.filter((s) => s.totalMatchedWords >= 3);

      for (const span of validSpans) {
        for (let i = span.pageStart; i <= span.pageEnd && i < pageWords.length; i++) {
          matchedItemIndices.add(pageWords[i].itemIdx);
        }
      }
    }

    // Fallback: match distinctive keywords (e.g. chemical names, specific numbers)
    if (matchedItemIndices.size === 0) {
      const distinctiveWords = targetWords.filter((w) => w.length >= 4);
      for (const dw of distinctiveWords) {
        for (const pw of pageWords) {
          if (pw.word === dw) {
            matchedItemIndices.add(pw.itemIdx);
          }
        }
      }
    }

    if (matchedItemIndices.size === 0) return [];

    const rawRects = Array.from(matchedItemIndices).map((idx) => {
      const item = textItems[idx];
      return {
        x: item.x,
        y: item.y,
        w: item.width,
        h: item.height,
      };
    });

    // 1. Group raw rects into distinct line buckets
    rawRects.sort((a, b) => (Math.abs(a.y - b.y) < 3 ? a.x - b.x : a.y - b.y));
    const lineBuckets: { y: number; rects: typeof rawRects }[] = [];

    for (const r of rawRects) {
      let bucket = lineBuckets.find((b) => Math.abs(b.y - r.y) < 4);
      if (!bucket) {
        bucket = { y: r.y, rects: [] };
        lineBuckets.push(bucket);
      }
      bucket.rects.push(r);
    }

    // Sort line buckets from top to bottom
    lineBuckets.sort((a, b) => a.y - b.y);

    const merged: { x: number; y: number; w: number; h: number }[] = [];

    // 2. Merge horizontally within each line and eliminate vertical overlaps with subsequent lines
    lineBuckets.forEach((bucket, lineIdx) => {
      bucket.rects.sort((a, b) => a.x - b.x);

      const lineMerged: { x: number; y: number; w: number; h: number }[] = [];
      for (const r of bucket.rects) {
        const prev = lineMerged[lineMerged.length - 1];
        if (prev && r.x <= prev.x + prev.w + 6) {
          prev.w = Math.max(prev.w, r.x + r.w - prev.x);
          prev.h = Math.max(prev.h, r.h);
        } else {
          lineMerged.push({ ...r });
        }
      }

      // Height constraint based on distance to the next line
      const nextBucket = lineBuckets[lineIdx + 1];
      const maxAllowedH = nextBucket
        ? Math.max(nextBucket.y - bucket.y - 1, 4)
        : Math.max(...lineMerged.map((r) => r.h));

      for (const r of lineMerged) {
        const clampedH = Math.min(r.h, maxAllowedH);
        const finalY = r.y + 0.5;
        const finalH = Math.max(clampedH - 1, 3);

        merged.push({
          x: r.x,
          y: finalY,
          w: r.w,
          h: finalH,
        });
      }
    });

    return merged;
  }, [passageHighlight, pageNumber, textItems]);

  // Snip selection state
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipCurrent, setSnipCurrent] = useState<{ x: number; y: number } | null>(null);
  const isSnippingRef = useRef(false);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: any = null;

    async function renderPage() {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (isCancelled) return;
        pageRef.current = page;

        const unscaledViewport = page.getViewport({ scale: 1.0 });
        const scale = containerWidth > 0 ? containerWidth / unscaledViewport.width : 1.0;
        const viewport = page.getViewport({ scale });

        const dpr = window.devicePixelRatio || 1;
        const displayWidth = Math.floor(viewport.width);
        const displayHeight = Math.floor(viewport.height);

        setDimensions({ width: displayWidth, height: displayHeight, scale });

        // Extract text items in parallel immediately so highlighting is ready without delay
        page.getTextContent().then((textContent) => {
          if (isCancelled) return;
          const items: TextItemData[] = [];
          const pageH = unscaledViewport.height;

          for (const item of textContent.items) {
            if (!('str' in item) || !item.str) continue;
            const tx = item.transform;
            const x = tx[4];
            const yBottomUp = tx[5];
            const width = item.width;
            const height = item.height || Math.abs(tx[0]);
            const yTopDown = pageH - yBottomUp - height;

            items.push({
              str: item.str,
              x,
              y: yTopDown,
              width,
              height,
            });
          }
          setTextItems(items);
        }).catch(() => {});

        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = Math.floor(displayWidth * dpr);
        canvas.height = Math.floor(displayHeight * dpr);
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
        };

        renderTask = page.render(renderContext as any);
        await renderTask.promise;

        if (!isCancelled) {
          setIsRendered(true);

          // Extract Link Annotations
            try {
              const pageAnnotations = await page.getAnnotations({ intent: 'display' });
              const links: LinkAnnotationData[] = [];

              for (const anno of pageAnnotations) {
                if (anno.subtype === 'Link') {
                  const [x1, y1, x2, y2] = anno.rect || [0,0,100,100];
                  // USE unscaledViewport to avoid double-scaling in the render loop
                  const pt1 = unscaledViewport.convertToViewportPoint(x1, y1);
                  const pt2 = unscaledViewport.convertToViewportPoint(x2, y2);
                  const left = Math.min(pt1[0], pt2[0]);
                  const top = Math.min(pt1[1], pt2[1]);
                  const w = Math.abs(pt2[0] - pt1[0]);
                  const h = Math.abs(pt2[1] - pt1[1]);
                  
                  let dest = anno.dest;
                  
                  // Fallback for GoTo actions if dest is not directly on the annotation
                  if (!dest && anno.action && anno.action.name === 'GoTo' && anno.action.dest) {
                     dest = anno.action.dest;
                  }
                  
                  if (!dest) continue;
                  
                  if (typeof dest === 'string') {
                    dest = await pdfDocument.getDestination(dest);
                  }

                  if (Array.isArray(dest) && dest.length > 0) {
                    const destRef = dest[0];
                    try {
                      let destPageNum = -1;
                      if (typeof destRef === 'number' || Number.isInteger(destRef)) {
                        destPageNum = (destRef as number) + 1;
                      } else if (typeof destRef === 'object' && destRef !== null) {
                        const destPageIndex = await pdfDocument.getPageIndex(destRef);
                        destPageNum = destPageIndex + 1;
                      }
                      
                      if (destPageNum > 0) {
                        links.push({
                          rect: { x: left, y: top, w, h },
                          destPageNum,
                          rawAnno: anno
                        });
                      }
                    } catch (e) {
                      console.warn('Failed to resolve link:', e);
                    }
                  }
                }
              }
              setLinkItems(links);
            } catch {
              // ignore
            }
        }
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${pageNumber}:`, err);
        }
      }
    }

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // ignore
        }
      }
      if (pageRef.current) {
        try {
          pageRef.current.cleanup();
        } catch {
          // ignore
        }
      }
    };
  }, [pdfDocument, pageNumber, containerWidth]);

  // Snip Mouse Handlers
  const handleSnipMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSnipMode || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setSnipStart({ x, y });
    setSnipCurrent({ x, y });
    isSnippingRef.current = true;
  };

  const handleSnipMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSnippingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
    setSnipCurrent({ x, y });
  };

  const handleSnipMouseUp = useCallback(() => {
    if (!isSnippingRef.current || !snipStart || !snipCurrent || !canvasRef.current) {
      isSnippingRef.current = false;
      setSnipStart(null);
      setSnipCurrent(null);
      return;
    }
    isSnippingRef.current = false;

    const x = Math.min(snipStart.x, snipCurrent.x);
    const y = Math.min(snipStart.y, snipCurrent.y);
    const w = Math.abs(snipCurrent.x - snipStart.x);
    const h = Math.abs(snipCurrent.y - snipStart.y);

    setSnipStart(null);
    setSnipCurrent(null);

    if (w < 15 || h < 15) return; // ignore accidental clicks

    const dpr = window.devicePixelRatio || 1;
    const sourceCanvas = canvasRef.current;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.floor(w * dpr);
    tempCanvas.height = Math.floor(h * dpr);

    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCtx.drawImage(
      sourceCanvas,
      x * dpr,
      y * dpr,
      w * dpr,
      h * dpr,
      0,
      0,
      w * dpr,
      h * dpr
    );

    tempCanvas.toBlob((blob) => {
      if (blob && onSnipComplete) {
        onSnipComplete(blob, pageNumber);
      }
    }, 'image/png');
  }, [snipStart, snipCurrent, pageNumber, onSnipComplete]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isSnipMode) {
      handleSnipMouseUp();
      return;
    }

    if (!onTextSelected) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (!text) return;

    // Use textItems and the DOM spans to find coordinates
    const spans = containerRef.current?.querySelectorAll('span.select-text');
    if (spans && textItems.length > 0) {
      const pdfRects: { x: number; y: number; w: number; h: number }[] = [];
      spans.forEach((span, i) => {
        if (selection.containsNode(span, true)) {
          const item = textItems[i];
          if (item) {
            pdfRects.push({
              x: item.x,
              y: item.y,
              w: item.width,
              h: item.height,
            });
          }
        }
      });
      
      if (pdfRects.length > 0) {
        onTextSelected({
          text,
          rects: pdfRects,
          page: pageNumber,
        });
      }
    }
  }, [isSnipMode, handleSnipMouseUp, onTextSelected, textItems, pageNumber]);

  // Compute snip preview rect
  const snipRect =
    snipStart && snipCurrent
      ? {
          left: Math.min(snipStart.x, snipCurrent.x),
          top: Math.min(snipStart.y, snipCurrent.y),
          width: Math.abs(snipCurrent.x - snipStart.x),
          height: Math.abs(snipCurrent.y - snipStart.y),
        }
      : null;

  return (
    <div
      ref={containerRef}
      onMouseDown={handleSnipMouseDown}
      onMouseMove={handleSnipMouseMove}
      onMouseUp={handleMouseUp}
      className={`relative mx-auto my-4 bg-white shadow-2xl rounded-sm overflow-hidden ${
        isSnipMode ? 'cursor-crosshair select-none' : ''
      }`}
      style={{
        width: dimensions ? `${dimensions.width}px` : `${containerWidth}px`,
        minHeight: dimensions ? `${dimensions.height}px` : `${containerWidth * 1.4}px`,
      }}
    >
      {/* High-DPI Canvas */}
      <canvas ref={canvasRef} className="block" />

      {/* Transparent Native Text Selection Layer */}
      {dimensions && isRendered && textItems.length > 0 && (
        <div
          className={`absolute top-0 left-0 overflow-hidden leading-none ${
            isSnipMode ? 'pointer-events-none' : 'select-text pointer-events-auto'
          }`}
          style={{
            width: `${dimensions.width}px`,
            height: `${dimensions.height}px`,
          }}
        >
          {textItems.map((item, idx) => (
            <span
              key={idx}
              className="absolute text-transparent select-text selection:bg-blue-500/40 selection:text-transparent"
              style={{
                left: `${item.x * dimensions.scale}px`,
                top: `${item.y * dimensions.scale}px`,
                width: `${item.width * dimensions.scale}px`,
                height: `${item.height * dimensions.scale}px`,
                fontSize: `${item.height * dimensions.scale}px`,
                lineHeight: `${item.height * dimensions.scale}px`,
                transformOrigin: 'left top',
                whiteSpace: 'pre',
              }}
            >
              {item.str}
            </span>
          ))}
        </div>
      )}

      {/* Annotation Overlay Layer */}
      {dimensions && isRendered && !isSnipMode && annotations && (
        <AnnotationOverlayLayer
          annotations={annotations}
          scale={dimensions.scale}
          width={dimensions.width}
          height={dimensions.height}
          onAnnotationClick={(anno) => {
            // Can be expanded later if needed
            console.log('Annotation clicked:', anno);
          }}
        />
      )}

      {/* Passage Highlight Overlay (Search Result Link) */}
      {dimensions && isRendered && highlightRects.length > 0 && (
        <>
          <div className="absolute inset-0 pointer-events-none z-10 mix-blend-multiply">
            {highlightRects.map((rect, i) => (
              <div
                key={`passage-hl-${i}`}
                className="absolute rounded-[2px] bg-amber-300/60 transition-all duration-300 animate-pulse"
                style={{
                  left: `${rect.x * dimensions.scale}px`,
                  top: `${rect.y * dimensions.scale}px`,
                  width: `${rect.w * dimensions.scale}px`,
                  height: `${rect.h * dimensions.scale}px`,
                }}
              />
            ))}
          </div>

          {/* Floating Dismiss Chip */}
          <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-900/90 border border-amber-500/80 text-amber-200 text-xs shadow-xl backdrop-blur-sm animate-in fade-in">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-medium text-[11px]">Suchtreffer markiert</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPassageHighlight(null);
              }}
              className="hover:text-white text-neutral-400 font-bold ml-1.5 text-xs transition-colors"
              title="Hervorhebung ausblenden"
            >
              ✕
            </button>
          </div>
        </>
      )}

      {/* Citation Overlay Hitboxes Layer */}
      {dimensions && isRendered && !isSnipMode && (
        <CitationOverlayLayer
          hitboxes={pageHitboxes}
          scale={dimensions.scale}
          width={dimensions.width}
          height={dimensions.height}
          onCitationClick={onCitationClick}
        />
      )}

      {/* Internal PDF Links (Figures, Tables, etc.) */}
      {dimensions && isRendered && !isSnipMode && linkItems.map((link, idx) => (
        <div
          key={`link-${idx}`}
          className="absolute pointer-events-auto rounded cursor-pointer transition-colors hover:bg-green-500/20 z-20 border border-green-400/20"
          style={{
            left: `${link.rect.x * dimensions.scale}px`,
            top: `${link.rect.y * dimensions.scale}px`,
            width: `${link.rect.w * dimensions.scale}px`,
            height: `${link.rect.h * dimensions.scale}px`,
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (onCitationClick) {
              onCitationClick('PDF Link', link.destPageNum, pageNumber);
            }
          }}
          title={`Jump to Page ${link.destPageNum}`}
        />
      ))}

      {/* Active Snipping Drag Selection Box */}
      {snipRect && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-500/20 pointer-events-none z-30 shadow-lg"
          style={{
            left: `${snipRect.left}px`,
            top: `${snipRect.top}px`,
            width: `${snipRect.width}px`,
            height: `${snipRect.height}px`,
          }}
        >
          <div className="absolute top-1 left-1 bg-blue-600 text-white text-[9px] font-mono px-1 rounded shadow">
            {Math.round(snipRect.width)} &times; {Math.round(snipRect.height)}
          </div>
        </div>
      )}

      {/* Page Number Badge */}
      <div className="absolute bottom-2 right-3 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-neutral-300 text-[10px] font-mono select-none pointer-events-none z-10">
        Page {pageNumber}
      </div>
    </div>
  );
};
