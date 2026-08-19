import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageItem } from './PdfPageItem';
import { CitationTooltip } from './CitationTooltip';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ViewerProps {
  documentId: string;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  hitboxes: Record<number, CitationHitbox[]>;
  targetPage?: number | null;
  isSnipMode?: boolean;
  onSnipComplete?: (blob: Blob, pageNumber: number) => void;
  onCitationClick?: (marker: string, pageNumber?: number) => void;
  onJumpToReferences?: (marker: string) => void;
}

export interface VirtualizedPdfViewerRef {
  scrollToPage: (pageNumber: number) => void;
}

export const VirtualizedPdfViewer = forwardRef<VirtualizedPdfViewerRef, ViewerProps>(({
  documentId,
  pdfDocument,
  hitboxes,
  targetPage,
  isSnipMode = false,
  onSnipComplete,
  onCitationClick,
  onJumpToReferences,
}, ref) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    if (!parentRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0] && entries[0].contentRect.width > 0) {
        setContainerWidth(Math.max(entries[0].contentRect.width - 48, 320));
      }
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: pdfDocument.numPages,
    getScrollElement: () => parentRef.current,
    estimateSize: () => containerWidth * 1.4,
    overscan: 2,
  });

  useImperativeHandle(ref, () => ({
    scrollToPage: (pageNumber: number) => {
      const index = Math.max(0, Math.min(pageNumber - 1, pdfDocument.numPages - 1));
      rowVirtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
    },
  }));

  useEffect(() => {
    if (targetPage && targetPage >= 1 && targetPage <= pdfDocument.numPages) {
      rowVirtualizer.scrollToIndex(targetPage - 1, { align: 'start', behavior: 'smooth' });
    }
  }, [targetPage, pdfDocument.numPages]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-y-auto bg-neutral-900 p-4 relative scroll-smooth">
      <div className="relative w-full mx-auto" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <PdfPageItem
              pdfDocument={pdfDocument}
              pageNumber={virtualRow.index + 1}
              containerWidth={containerWidth}
              pageHitboxes={hitboxes[virtualRow.index + 1] || []}
              isSnipMode={isSnipMode}
              onSnipComplete={onSnipComplete}
              onCitationClick={onCitationClick}
            />
          </div>
        ))}
      </div>

      <CitationTooltip
        documentId={documentId}
        onJumpToReferences={onJumpToReferences}
      />
    </div>
  );
});

VirtualizedPdfViewer.displayName = 'VirtualizedPdfViewer';
