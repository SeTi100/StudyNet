import { create } from 'zustand';

export interface HoverPosition {
  x: number;
  y: number;
}

export interface PassageHighlight {
  text: string;
  pageNumber: number;
}

export interface ViewerState {
  activeCitationMarker: string | null;
  hoverPosition: HoverPosition | null;
  sourcePageNum: number | null;
  setHoveredCitation: (marker: string | null, position?: HoverPosition | null, sourcePageNum?: number | null) => void;
  activeAnnotationId: string | null;
  pendingSelection: { text: string; rects: { x: number; y: number; w: number; h: number }[]; page: number } | null;
  annotationMode: 'none' | 'highlight' | 'comment';
  passageHighlight: PassageHighlight | null;
  highlightOpacity: number;
  setActiveAnnotation: (id: string | null) => void;
  setPendingSelection: (sel: { text: string; rects: { x: number; y: number; w: number; h: number }[]; page: number } | null) => void;
  setAnnotationMode: (mode: 'none' | 'highlight' | 'comment') => void;
  setPassageHighlight: (highlight: PassageHighlight | null) => void;
  setHighlightOpacity: (opacity: number) => void;
}

const getInitialOpacity = (): number => {
  try {
    const saved = localStorage.getItem('studynet_highlight_opacity');
    if (saved) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 0.1 && val <= 1.0) return val;
    }
  } catch {}
  return 0.35;
};

export const useViewerStore = create<ViewerState>((set) => ({
  activeCitationMarker: null,
  hoverPosition: null,
  sourcePageNum: null,
  setHoveredCitation: (marker, position = null, sourcePageNum = null) =>
    set({ activeCitationMarker: marker, hoverPosition: position, sourcePageNum }),
  activeAnnotationId: null,
  pendingSelection: null,
  annotationMode: 'none',
  passageHighlight: null,
  highlightOpacity: getInitialOpacity(),
  setActiveAnnotation: (id) =>
    set((state) => ({
      activeAnnotationId: id,
      pendingSelection: id ? null : state.pendingSelection,
    })),
  setPendingSelection: (sel) =>
    set((state) => ({
      pendingSelection: sel,
      activeAnnotationId: sel ? null : state.activeAnnotationId,
    })),
  setAnnotationMode: (mode) => set({ annotationMode: mode }),
  setPassageHighlight: (highlight) => set({ passageHighlight: highlight }),
  setHighlightOpacity: (opacity: number) => {
    try {
      localStorage.setItem('studynet_highlight_opacity', String(opacity));
    } catch {}
    set({ highlightOpacity: opacity });
  },
}));
