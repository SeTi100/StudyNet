import { create } from 'zustand';

export interface HoverPosition {
  x: number;
  y: number;
}

export interface ViewerState {
  activeCitationMarker: string | null;
  hoverPosition: HoverPosition | null;
  setHoveredCitation: (marker: string | null, position?: HoverPosition | null) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  activeCitationMarker: null,
  hoverPosition: null,
  setHoveredCitation: (marker, position = null) =>
    set({ activeCitationMarker: marker, hoverPosition: position }),
}));
