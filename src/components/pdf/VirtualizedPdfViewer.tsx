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
  initialPageRatio?: number; // 0.0 bis 1.0 relativer Offset innerhalb der Seite
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
  initialPageRatio = 0,
  isSnipMode = false,
  onSnipComplete,
  onCitationClick,
  onJumpToReferences,
  onVisiblePageChange,
}, ref) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return Math.max(window.innerWidth - 300, 320);
    }
    return 800;
  });
  const [pageAspectRatio, setPageAspectRatio] = useState<number>(1.414);
  const [isWidthReady, setIsWidthReady] = useState(false);
  const isInitialScrollAppliedRef = useRef<boolean>(false);
  
  const updateReadingProgress = useDocumentStore(state => state.updateReadingProgress);
  const markPageRead = useDocumentStore(state => state.markPageRead);
  const { setPendingSelection } = useViewerStore();

  // Inspect page 1 aspect ratio once per pdfDocument for exact estimateSize
  useEffect(() => {
    let isCurrent = true;
    pdfDocument.getPage(1).then((page) => {
      if (!isCurrent) return;
      const vp = page.getViewport({ scale: 1.0 });
      if (vp.width > 0 && vp.height > 0) {
        setPageAspectRatio(vp.height / vp.width);
      }
    }).catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [pdfDocument]);

  useEffect(() => {
    if (!parentRef.current) return;
    const initialW = Math.max(parentRef.current.clientWidth - 48, 320);
    setContainerWidth(initialW);
    setIsWidthReady(true);

    const observer = new ResizeObserver((entries) => {
      if (entries[0] && entries[0].contentRect.width > 0) {
        setContainerWidth(Math.max(entries[0].contentRect.width - 48, 320));
        setIsWidthReady(true);
      }
    });
    observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const estimatedItemHeight = Math.floor(containerWidth * pageAspectRatio) + 24;

  const rowVirtualizer = useVirtualizer({
    count: pdfDocument.numPages,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedItemHeight,
    overscan: 2,
  });

  const lastSavedRef = useRef<{ page: number; ratio: number }>({
    page: targetPage && targetPage >= 1 ? targetPage : 1,
    ratio: typeof initialPageRatio === 'number' ? initialPageRatio : 0,
  });

  useImperativeHandle(ref, () => ({
    scrollToPage: (pageNumber: number) => {
      const el = parentRef.current;
      const pageIndex = Math.max(0, Math.min(pageNumber - 1, pdfDocument.numPages - 1));
      const targetTop = Math.max(0, Math.floor(pageIndex * estimatedItemHeight));
      if (el) el.scrollTop = targetTop;
      rowVirtualizer.scrollToOffset(targetTop, { align: 'start', behavior: 'auto' });
      lastSavedRef.current = { page: pageNumber, ratio: 0 };
    },
  }));

  // Apply initial scroll / targetPage scroll instantly without lag or smooth-animation bounce
  useEffect(() => {
    if (!isWidthReady) return;
    const el = parentRef.current;
    if (!el) return;

    const resumePage = targetPage && targetPage >= 1 ? targetPage : 1;
    const pageIndex = Math.max(0, Math.min(resumePage - 1, pdfDocument.numPages - 1));
    const subRatio = (!isInitialScrollAppliedRef.current && typeof initialPageRatio === 'number') 
      ? Math.min(1, Math.max(0, initialPageRatio)) 
      : 0;

    const targetTop = Math.max(0, Math.floor(pageIndex * estimatedItemHeight + subRatio * (estimatedItemHeight - 24)));
    el.scrollTop = targetTop;
    rowVirtualizer.scrollToOffset(targetTop, { align: 'start', behavior: 'auto' });
    isInitialScrollAppliedRef.current = true;
    lastSavedRef.current = { page: resumePage, ratio: subRatio };
  }, [targetPage, pdfDocument.numPages, isWidthReady, estimatedItemHeight]);

  // Handle user scroll cleanly and calculate exact page + sub-page offset
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || !isInitialScrollAppliedRef.current) return;

    const scrollTop = el.scrollTop;
    const rawPage = Math.floor(scrollTop / estimatedItemHeight);
    const pageIndex = Math.max(0, Math.min(rawPage, pdfDocument.numPages - 1));
    const pageNumber = pageIndex + 1;

    const offsetInPage = Math.max(0, scrollTop - (pageIndex * estimatedItemHeight));
    const rawRatio = (estimatedItemHeight - 24) > 0 ? offsetInPage / (estimatedItemHeight - 24) : 0;
    const pageRatio = Math.min(1, Math.max(0, Math.round(rawRatio * 100) / 100));

    lastSavedRef.current = { page: pageNumber, ratio: pageRatio };

    if (onVisiblePageChange) {
      onVisiblePageChange(pageNumber);
    }

    // Direct update to store & Dexie
    updateReadingProgress(documentId, pageNumber, pageRatio);
  }, [estimatedItemHeight, pdfDocument.numPages, onVisiblePageChange, updateReadingProgress, documentId]);

  // Dwell timer: page only counts as read in progress bar if viewed for >= 2 seconds
  useEffect(() => {
    const visiblePage = lastSavedRef.current.page;
    const dwellTimer = setTimeout(() => {
      markPageRead(documentId, visiblePage);
    }, 2000);
    return () => clearTimeout(dwellTimer);
  }, [lastSavedRef.current.page, documentId, markPageRead]);

  // Flush last visible page & ratio on unmount so navigation immediately persists position
  useEffect(() => {
    return () => {
      if (documentId && isInitialScrollAppliedRef.current) {
        const { page, ratio } = lastSavedRef.current;
        useDocumentStore.getState().updateReadingProgress(documentId, page, ratio);
      }
    };
  }, [documentId]);

  const handleTextSelected = useCallback((selection: SelectionData) => {
    setPendingSelection(selection);
  }, [setPendingSelection]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      onScroll={handleScroll}
      className="h-full w-full overflow-y-auto bg-neutral-900 p-4 relative"
    >
      <div className="relative w-full mx-auto" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualItems.map((virtualRow) => (
          <div
            key={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            className="pb-6 w-full flex justify-center"
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

