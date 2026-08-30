import React, { useRef, useEffect, useState, useImperativeHandle, forwardRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as pdfjsLib from 'pdfjs-dist';
import { PdfPageItem, SelectionData } from './PdfPageItem';
import { CitationTooltip } from './CitationTooltip';
import { AnnotationToolbar } from './AnnotationToolbar';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';
import { useDocumentStore } from '../../store/useDocumentStore';
import { useViewerStore } from '../../store/useViewerStore';

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ViewerProps {
  documentId: string;
  pdfDocument: pdfjsLib.PDFDocumentProxy;
  hitboxes: Record<number, CitationHitbox[]>;
  targetPage?: number | null;
  isSnipMode?: boolean;
  onSnipComplete?: (blob: Blob, pageNumber: number) => void;
  onCitationClick?: (marker: string, targetPage?: number, sourcePage?: number) => void;
  onJumpToReferences?: (marker: string, sourcePage?: number) => void;
  onVisiblePageChange?: (page: number) => void;
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
  onVisiblePageChange,
}, ref) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  
  const updateReadingProgress = useDocumentStore(state => state.updateReadingProgress);
  const markPageRead = useDocumentStore(state => state.markPageRead);
  const { setPendingSelection } = useViewerStore();

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

  // Track visible page and update reading progress + dwell time
  const virtualItems = rowVirtualizer.getVirtualItems();
  
  useEffect(() => {
    if (virtualItems.length > 0) {
      const visiblePage = virtualItems[0].index + 1;
      
      if (onVisiblePageChange) {
        onVisiblePageChange(visiblePage);
      }

      // Fast update (500ms) for lastReadPage position so user can resume where they left off
      const positionTimer = setTimeout(() => {
        updateReadingProgress(documentId, visiblePage);
      }, 500);

      // Dwell timer (2000ms): page only counts as read if user stays on it for at least 2 seconds
      const dwellTimer = setTimeout(() => {
        markPageRead(documentId, visiblePage);
      }, 2000);

      return () => {
        clearTimeout(positionTimer);
        clearTimeout(dwellTimer);
      };
    }
  }, [virtualItems, documentId, updateReadingProgress, markPageRead, onVisiblePageChange]);

  const handleTextSelected = useCallback((selection: SelectionData) => {
    setPendingSelection(selection);
  }, [setPendingSelection]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-y-auto bg-neutral-900 p-4 relative scroll-smooth">
      <div className="relative w-full mx-auto" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <PdfPageItem
              documentId={documentId}
              pdfDocument={pdfDocument}
              pageNumber={virtualRow.index + 1}
              containerWidth={containerWidth}
              pageHitboxes={hitboxes[virtualRow.index + 1] || []}
              isSnipMode={isSnipMode}
              onSnipComplete={onSnipComplete}
              onCitationClick={onCitationClick}
              onTextSelected={handleTextSelected}
            />
          </div>
        ))}
      </div>

      <CitationTooltip
        documentId={documentId}
        onJumpToReferences={onJumpToReferences}
      />
      
      <AnnotationToolbar documentId={documentId} />
    </div>
  );
});

VirtualizedPdfViewer.displayName = 'VirtualizedPdfViewer';

