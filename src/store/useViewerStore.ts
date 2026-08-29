import { create } from 'zustand';

export interface HoverPosition {
  x: number;
  y: number;
}

export interface ViewerState {
  activeCitationMarker: string | null;
  hoverPosition: HoverPosition | null;
  sourcePageNum: number | null;
  setHoveredCitation: (marker: string | null, position?: HoverPosition | null, sourcePageNum?: number | null) => void;
  activeAnnotationId: string | null;
  pendingSelection: { text: string; rects: { x: number; y: number; w: number; h: number }[]; page: number } | null;
  annotationMode: 'none' | 'highlight' | 'comment';
  setActiveAnnotation: (id: string | null) => void;
  setPendingSelection: (sel: { text: string; rects: { x: number; y: number; w: number; h: number }[]; page: number } | null) => void;
  setAnnotationMode: (mode: 'none' | 'highlight' | 'comment') => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  activeCitationMarker: null,
  hoverPosition: null,
  sourcePageNum: null,
  setHoveredCitation: (marker, position = null, sourcePageNum = null) =>
    set({ activeCitationMarker: marker, hoverPosition: position, sourcePageNum }),
  activeAnnotationId: null,
  pendingSelection: null,
  annotationMode: 'none',
  setActiveAnnotation: (id) => set({ activeAnnotationId: id }),
  setPendingSelection: (sel) => set({ pendingSelection: sel }),
  setAnnotationMode: (mode) => set({ annotationMode: mode }),
}));
