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
}

export const useViewerStore = create<ViewerState>((set) => ({
  activeCitationMarker: null,
  hoverPosition: null,
  sourcePageNum: null,
  setHoveredCitation: (marker, position = null, sourcePageNum = null) =>
    set({ activeCitationMarker: marker, hoverPosition: position, sourcePageNum }),
}));
