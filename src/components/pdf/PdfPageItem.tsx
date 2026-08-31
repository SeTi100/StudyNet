import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { CitationOverlayLayer } from './CitationOverlayLayer';
import { AnnotationOverlayLayer } from './AnnotationOverlayLayer';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';
import { db, AnnotationRecord } from '../../db/schema';
import { useLiveQuery } from 'dexie-react-hooks';
import { useViewerStore } from '../../store/useViewerStore';
import { normalizeLigaturesAndFontArtifacts } from '../../utils/textNormalization';

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
  const activeAnnotationId = useViewerStore((s) => s.activeAnnotationId);

  // Calculate matching bounding rects for passage search highlight (Start-End Anchor Matching)
  const highlightRects = useMemo(() => {
    if (!passageHighlight || passageHighlight.pageNumber !== pageNumber || textItems.length === 0) {
      return [];
    }

    const passageText = passageHighlight.text.trim();
    if (!passageText) return [];

    // Helper: Build a fault-tolerant regex from a text snippet
    const buildFuzzyRegex = (snippet: string): RegExp | null => {
      if (!snippet) return null;
      const normalized = normalizeLigaturesAndFontArtifacts(snippet);
      // Remove all non-alphanumerics
      const alphanumeric = normalized.replace(/[^a-zA-Z0-9]/g, '');
      if (alphanumeric.length < 3) return null;

      // Use up to 35 alphanumeric characters for the anchor
      const targetChars = alphanumeric.slice(0, 35);
      const parts = Array.from(targetChars).map((char) => {
        const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (char.toLowerCase() === 'f') {
          return '(?:f|fi|fl|ff|[\uFB00-\uFB06]|Æ|Ø|Œ)';
        }
        if (char.toLowerCase() === 'i') {
          return '(?:i|fi|ffi|[\uFB01\uFB03]|Æ)';
        }
        return escaped;
      });

      // Allow spaces, hyphens, dashes, soft-hyphens, ±, and linebreaks between characters
      const separator = '[\\s\\-\\u2010-\\u2015\\u00AD±]*';
      return new RegExp(parts.join(separator), 'i');
    };

    // 1. Build concatenated page text stream and map each char index to item index in textItems
    let pageString = '';
    const charToItemIndex: number[] = [];

    for (let i = 0; i < textItems.length; i++) {
      const itemStr = textItems[i].str;
      for (let c = 0; c < itemStr.length; c++) {
        charToItemIndex.push(i);
      }
      pageString += itemStr;
    }

    if (pageString.length === 0) return [];

    // 2. Extract Start Anchor (~60 chars) and End Anchor (~60 chars) from passage
    const startSnippet = passageText.slice(0, Math.min(80, passageText.length));
    const endSnippet = passageText.slice(Math.max(0, passageText.length - 80));

    const startRegex = buildFuzzyRegex(startSnippet);
    const endRegex = buildFuzzyRegex(endSnippet);

    let startItemIdx = -1;
    let endItemIdx = -1;

    if (startRegex) {
      const match = startRegex.exec(pageString);
      if (match && match.index < charToItemIndex.length) {
        startItemIdx = charToItemIndex[match.index];
      }
    }

    if (endRegex) {
      const match = endRegex.exec(pageString);
      if (match) {
        const matchEndPos = Math.min(match.index + match[0].length - 1, charToItemIndex.length - 1);
        endItemIdx = charToItemIndex[matchEndPos];
      }
    }

    // 3. Determine matched range of item indices
    const matchedItemIndices = new Set<number>();

    if (startItemIdx !== -1 && endItemIdx !== -1 && endItemIdx >= startItemIdx) {
      // Perfect continuous block from start anchor to end anchor!
      for (let i = startItemIdx; i <= endItemIdx; i++) {
        matchedItemIndices.add(i);
      }
    } else if (startItemIdx !== -1) {
      // Start anchor matched: Highlight from start anchor onwards
      const approxCharLen = passageText.length;
      let count = 0;
      let i = startItemIdx;
      while (i < textItems.length && count < approxCharLen * 1.15) {
        matchedItemIndices.add(i);
        count += textItems[i].str.length;
        i++;
      }
    } else if (endItemIdx !== -1) {
      // End anchor matched: Highlight backwards to end anchor
      const approxCharLen = passageText.length;
      let count = 0;
      let i = endItemIdx;
      while (i >= 0 && count < approxCharLen * 1.15) {
        matchedItemIndices.add(i);
        count += textItems[i].str.length;
        i--;
      }
    }

    // 4. Fallback: If anchor matching found nothing, use word token run matching
    if (matchedItemIndices.size === 0) {
      const targetWords = normalizeLigaturesAndFontArtifacts(passageText)
        .split(/\s+/)
        .map((w) => normalizeLigaturesAndFontArtifacts(w).toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter((w) => w.length > 0);

      if (targetWords.length > 0) {
        interface WordEntry {
          word: string;
          itemIdx: number;
        }
        const pageWords: WordEntry[] = [];
        textItems.forEach((item, itemIdx) => {
          const cleanedStr = normalizeLigaturesAndFontArtifacts(item.str);
          const words = cleanedStr.split(/\s+/);
          for (const w of words) {
            const norm = w.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (norm.length > 0) pageWords.push({ word: norm, itemIdx });
          }
        });

        // Find contiguous word run
        let bestRunStart = -1;
        let bestRunEnd = -1;
        let maxRunLen = 0;

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
              if (len > maxRunLen) {
                maxRunLen = len;
                bestRunStart = pageWords[p].itemIdx;
                bestRunEnd = pageWords[p + len - 1].itemIdx;
              }
            }
          }
        }

        if (maxRunLen >= 2 && bestRunStart !== -1 && bestRunEnd >= bestRunStart) {
          for (let i = bestRunStart; i <= bestRunEnd; i++) {
            matchedItemIndices.add(i);
          }
        }
      }
    }

    if (matchedItemIndices.size === 0) return [];

    // 5. Convert matched indices to clean, merged bounding rectangles
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

        // Auf Mobilgeräten (Hochformat < 600px) nutzen wir echtes 4K/Retina-Supersampling (mindestens 4x bzw. DPR*2),
        // sodass selbst bei starkem 300%-400% Hineinzoomen auf dem Handy alle Buchstaben und Formeln absolut gestochen scharf bleiben!
        const dpr = window.devicePixelRatio || 1;
        const renderScaleMultiplier = containerWidth < 600 
          ? Math.max(dpr * 1.5, 4.0) 
          : Math.max(dpr, 1.75);

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

        const renderViewport = page.getViewport({ scale: scale * renderScaleMultiplier });

        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const renderContext = {
          canvasContext: ctx,
          viewport: renderViewport,
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
                  
                  try {
                    let resolvedDest = dest;
                    if (typeof resolvedDest === 'string') {
                      try {
                        resolvedDest = await pdfDocument.getDestination(resolvedDest);
                      } catch {
                        resolvedDest = null;
                      }
                    }

                    if (Array.isArray(resolvedDest) && resolvedDest.length > 0) {
                      const destRef = resolvedDest[0];
                      let destPageNum = -1;
                      if (typeof destRef === 'number' || Number.isInteger(destRef)) {
                        destPageNum = (destRef as number) + 1;
                      } else if (typeof destRef === 'object' && destRef !== null) {
                        try {
                          const destPageIndex = await pdfDocument.getPageIndex(destRef);
                          destPageNum = destPageIndex + 1;
                        } catch {
                          // Ignore malformed Kid / NameTree references in third-party PDFs
                        }
                      }
                      
                      if (destPageNum > 0) {
                        links.push({
                          rect: { x: left, y: top, w, h },
                          destPageNum,
                          rawAnno: anno
                        });
                      }
                    }
                  } catch {
                    // Ignore broken individual link annotations
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

    const sourceCanvas = canvasRef.current;
    if (!sourceCanvas || !dimensions) return;

    const scaleRatio = sourceCanvas.width / dimensions.width;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.floor(w * scaleRatio);
    tempCanvas.height = Math.floor(h * scaleRatio);

    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;

    tempCtx.drawImage(
      sourceCanvas,
      x * scaleRatio,
      y * scaleRatio,
      w * scaleRatio,
      h * scaleRatio,
      0,
      0,
      w * scaleRatio,
      h * scaleRatio
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

    // Wenn das große Markierungsfenster geöffnet ist, keine neue Selektion starten
    if (activeAnnotationId || !onTextSelected) return;

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
  }, [isSnipMode, handleSnipMouseUp, onTextSelected, textItems, pageNumber, activeAnnotationId]);

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
      className={`relative mx-auto bg-white shadow-2xl rounded-sm overflow-hidden ${
        isSnipMode ? 'cursor-crosshair select-none' : ''
      }`}
      style={{
        width: dimensions ? `${dimensions.width}px` : `${containerWidth}px`,
        height: dimensions ? `${dimensions.height}px` : `${Math.floor(containerWidth * 1.414)}px`,
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
