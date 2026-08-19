import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { CitationOverlayLayer } from './CitationOverlayLayer';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';

interface TextItemData {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfPageItemProps {
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  containerWidth: number;
  pageHitboxes: CitationHitbox[];
  isSnipMode?: boolean;
  onSnipComplete?: (blob: Blob, pageNumber: number) => void;
  onCitationClick?: (marker: string, pageNumber?: number) => void;
}

export const PdfPageItem: React.FC<PdfPageItemProps> = ({
  pdfDocument,
  pageNumber,
  containerWidth,
  pageHitboxes,
  isSnipMode = false,
  onSnipComplete,
  onCitationClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number; scale: number } | null>(null);
  const [isRendered, setIsRendered] = useState(false);
  const [textItems, setTextItems] = useState<TextItemData[]>([]);
  const pageRef = useRef<pdfjsLib.PDFPageProxy | null>(null);

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

          // Extract text items for selectable text layer
          try {
            const textContent = await page.getTextContent();
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
          } catch {
            // text layer fallback
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
      onMouseUp={handleSnipMouseUp}
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
