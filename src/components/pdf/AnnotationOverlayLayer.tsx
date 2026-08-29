import React, { useState } from 'react';
import { AnnotationRecord } from '../../db/schema';
import { useViewerStore } from '../../store/useViewerStore';

interface AnnotationOverlayLayerProps {
  annotations: AnnotationRecord[];
  scale: number;
  width: number;
  height: number;
  onAnnotationClick: (annotation: AnnotationRecord) => void;
}

export const AnnotationOverlayLayer: React.FC<AnnotationOverlayLayerProps> = ({
  annotations,
  scale,
  width,
  height,
  onAnnotationClick,
}) => {
  const { setActiveAnnotation } = useViewerStore();
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  if (!annotations || annotations.length === 0) return null;

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none z-10"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {annotations.map((annotation) => (
        <React.Fragment key={annotation.id}>
          {annotation.rects.map((rect, rIdx) => (
            <div
              key={`${annotation.id}-${rIdx}`}
              className="absolute pointer-events-auto rounded cursor-pointer transition-all duration-150 border ring-1 ring-transparent hover:ring-2"
              style={{
                left: `${rect.x * scale}px`,
                top: `${rect.y * scale}px`,
                width: `${Math.max(rect.w * scale, 6)}px`,
                height: `${Math.max(rect.h * scale, 10)}px`,
                backgroundColor: `${annotation.color}40`, // Add transparency (hex 40 = ~25% opacity)
                borderColor: `${annotation.color}60`,
                '--tw-ring-color': annotation.color,
              } as React.CSSProperties}
              onMouseEnter={() => {
                setHoveredAnnotationId(annotation.id);
                setActiveAnnotation(annotation.id);
              }}
              onMouseLeave={() => {
                setHoveredAnnotationId(null);
                setActiveAnnotation(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onAnnotationClick(annotation);
              }}
              title={annotation.comment || annotation.selectedText || 'Annotation'}
            />
          ))}
          {/* Tooltip for comment */}
          {hoveredAnnotationId === annotation.id && annotation.comment && (
            <div
              className="absolute pointer-events-none z-50 bg-gray-800 text-white text-xs rounded p-2 shadow-lg max-w-xs break-words"
              style={{
                left: `${(annotation.rects[0]?.x || 0) * scale}px`,
                top: `${(annotation.rects[0]?.y || 0) * scale - 30}px`,
              }}
            >
              {annotation.comment}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};
