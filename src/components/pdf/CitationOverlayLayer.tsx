import React from 'react';
import { useViewerStore } from '../../store/useViewerStore';
import { CitationHitbox } from '../../workers/pdfProcessor.worker';

interface CitationOverlayLayerProps {
  hitboxes: CitationHitbox[];
  scale: number;
  width: number;
  height: number;
  onCitationClick?: (marker: string, pageNumber?: number) => void;
}

export const CitationOverlayLayer: React.FC<CitationOverlayLayerProps> = ({
  hitboxes,
  scale,
  width,
  height,
  onCitationClick,
}) => {
  const setHoveredCitation = useViewerStore((state) => state.setHoveredCitation);

  if (!hitboxes || hitboxes.length === 0) return null;

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none z-10"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {hitboxes.map((hitbox, hIdx) =>
        hitbox.rects.map((rect, rIdx) => (
          <div
            key={`${hIdx}-${rIdx}-${hitbox.marker}`}
            className="absolute pointer-events-auto rounded cursor-pointer transition-all duration-150 bg-blue-500/15 hover:bg-blue-500/35 border border-blue-400/40 hover:border-blue-400 ring-1 ring-transparent hover:ring-blue-400/50"
            style={{
              left: `${rect.x * scale}px`,
              top: `${rect.y * scale}px`,
              width: `${Math.max(rect.w * scale, 6)}px`,
              height: `${Math.max(rect.h * scale, 10)}px`,
            }}
            onMouseEnter={(e) => {
              setHoveredCitation(hitbox.marker, { x: e.clientX, y: e.clientY });
            }}
            onMouseMove={(e) => {
              setHoveredCitation(hitbox.marker, { x: e.clientX, y: e.clientY });
            }}
            onMouseLeave={() => {
              setHoveredCitation(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (onCitationClick) {
                onCitationClick(hitbox.marker, hitbox.pageNumber);
              }
            }}
            title={`Citation: ${hitbox.marker} (Click to jump to references)`}
          />
        ))
      )}
    </div>
  );
};
