import React, { useState, useRef, useEffect } from 'react';
import { db, AnnotationRecord } from '../../db/schema';
import { useViewerStore } from '../../store/useViewerStore';
import { Trash2, MessageSquare, X, Check, Edit2, Sliders } from 'lucide-react';

interface AnnotationOverlayLayerProps {
  annotations: AnnotationRecord[];
  scale: number;
  width: number;
  height: number;
  onAnnotationClick?: (annotation: AnnotationRecord) => void;
}

export const HIGHLIGHT_COLORS = [
  { name: 'Gelb', value: '#FFEB3B', label: 'Gelb' },
  { name: 'Grün', value: '#4CAF50', label: 'Grün' },
  { name: 'Blau', value: '#2196F3', label: 'Blau' },
  { name: 'Rot', value: '#F44336', label: 'Rot' },
  { name: 'Lila', value: '#9C27B0', label: 'Lila' },
  { name: 'Orange', value: '#FF9800', label: 'Orange' },
];

/**
 * Konvertiert einen Hex-Farbcode in rgba für sanfte Textmarkierungen.
 */
function hexToRgba(hex: string, alpha: number = 0.35): string {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const r = parseInt(clean.substring(0, 2), 16) || 255;
  const g = parseInt(clean.substring(2, 4), 16) || 235;
  const b = parseInt(clean.substring(4, 6), 16) || 59;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const AnnotationOverlayLayer: React.FC<AnnotationOverlayLayerProps> = ({
  annotations,
  scale,
  width,
  height,
  onAnnotationClick,
}) => {
  const { setActiveAnnotation, highlightOpacity, setHighlightOpacity } = useViewerStore();
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationRecord | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Kommentar-Bearbeitungsmodus im Popover
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [commentInput, setCommentInput] = useState('');

  const popoverRef = useRef<HTMLDivElement>(null);

  // Klick außerhalb des Popovers schließt dieses
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setSelectedAnnotation(null);
        setActiveAnnotation(null);
        setMenuPosition(null);
        setIsEditingComment(false);
      }
    };

    if (selectedAnnotation) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [selectedAnnotation, setActiveAnnotation]);

  if (!annotations || annotations.length === 0) return null;

  const handleAnnotationClick = (annotation: AnnotationRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    // Browser-Auswahl zurücksetzen, damit kein Text-Selektions-Toolbar getriggert wird
    window.getSelection()?.removeAllRanges();
    
    setSelectedAnnotation(annotation);
    setActiveAnnotation(annotation.id);
    setCommentInput(annotation.comment || '');
    setIsEditingComment(false);

    // Berechne Popover-Position basierend auf dem ersten Rechteck
    const firstRect = annotation.rects[0];
    if (firstRect) {
      setMenuPosition({
        x: Math.max(10, firstRect.x * scale),
        y: Math.max(10, firstRect.y * scale - 10),
      });
    }

    onAnnotationClick?.(annotation);
  };

  const handleDeleteAnnotation = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.annotations.delete(annotationId);
      setSelectedAnnotation(null);
      setActiveAnnotation(null);
      setMenuPosition(null);
    } catch (err) {
      console.error('Fehler beim Löschen der Markierung:', err);
    }
  };

  const handleColorChange = async (annotation: AnnotationRecord, newColor: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.annotations.update(annotation.id, {
        color: newColor,
        updatedAt: new Date(),
      });
      setSelectedAnnotation({
        ...annotation,
        color: newColor,
      });
    } catch (err) {
      console.error('Fehler beim Ändern der Farbe:', err);
    }
  };

  const handleOpacityChange = async (annotation: AnnotationRecord, newOpacity: number) => {
    try {
      await db.annotations.update(annotation.id, {
        opacity: newOpacity,
        updatedAt: new Date(),
      });
      setSelectedAnnotation({
        ...annotation,
        opacity: newOpacity,
      });
      setHighlightOpacity(newOpacity);
    } catch (err) {
      console.error('Fehler beim Ändern der Deckkraft:', err);
    }
  };

  const handleSaveComment = async (annotation: AnnotationRecord) => {
    try {
      const updatedComment = commentInput.trim() || undefined;
      await db.annotations.update(annotation.id, {
        comment: updatedComment,
        type: updatedComment ? 'comment' : 'highlight',
        updatedAt: new Date(),
      });
      setSelectedAnnotation({
        ...annotation,
        comment: updatedComment,
        type: updatedComment ? 'comment' : 'highlight',
      });
      setIsEditingComment(false);
    } catch (err) {
      console.error('Fehler beim Speichern des Kommentars:', err);
    }
  };

  return (
    <div
      className="absolute top-0 left-0 pointer-events-none z-30"
      style={{ width: `${width}px`, height: `${height}px` }}
    >
      {/* ── 1. Highlighter Rects (wie im Such-Tool mit mix-blend-multiply) ────── */}
      <div className="absolute inset-0 pointer-events-none mix-blend-multiply z-10">
        {annotations.map((annotation) => {
          const isSelected = selectedAnnotation?.id === annotation.id;
          const isHovered = hoveredAnnotationId === annotation.id;
          const currentOpacity = annotation.opacity ?? highlightOpacity ?? 0.35;
          const effectiveOpacity = isSelected ? Math.min(1.0, currentOpacity + 0.25) : isHovered ? Math.min(1.0, currentOpacity + 0.15) : currentOpacity;

          return (
            <React.Fragment key={annotation.id}>
              {annotation.rects.map((rect, rIdx) => (
                <div
                  key={`${annotation.id}-${rIdx}`}
                  className="absolute pointer-events-auto rounded-[2px] cursor-pointer transition-all duration-150"
                  style={{
                    left: `${rect.x * scale}px`,
                    top: `${rect.y * scale}px`,
                    width: `${Math.max(rect.w * scale, 6)}px`,
                    height: `${Math.max(rect.h * scale, 10)}px`,
                    backgroundColor: hexToRgba(annotation.color, effectiveOpacity),
                    boxShadow: isSelected
                      ? `0 0 0 1px ${annotation.color}, 0 2px 4px rgba(0,0,0,0.15)`
                      : isHovered
                      ? `0 0 0 1px ${annotation.color}80`
                      : 'none',
                  }}
                  onMouseEnter={() => {
                    setHoveredAnnotationId(annotation.id);
                    setActiveAnnotation(annotation.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredAnnotationId(null);
                    setActiveAnnotation(null);
                  }}
                  onClick={(e) => handleAnnotationClick(annotation, e)}
                  title={annotation.comment ? `Kommentar: "${annotation.comment}" (Klicken zum Bearbeiten/Löschen)` : 'Klicken zum Bearbeiten oder Löschen'}
                />
              ))}
            </React.Fragment>
          );
        })}
      </div>

      {/* ── 2. Hover Tooltip (wenn kein Popover offen ist) ──────────────────── */}
      {!selectedAnnotation && hoveredAnnotationId && (
        (() => {
          const hoveredAnno = annotations.find((a) => a.id === hoveredAnnotationId);
          if (!hoveredAnno) return null;
          const firstRect = hoveredAnno.rects[0];
          if (!firstRect) return null;

          return (
            <div
              className="absolute pointer-events-none z-50 bg-neutral-900/95 text-white text-xs rounded-lg px-2.5 py-1.5 shadow-xl border border-neutral-700 max-w-xs break-words backdrop-blur-sm animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: `${firstRect.x * scale}px`,
                top: `${Math.max(5, firstRect.y * scale - 36)}px`,
              }}
            >
              {hoveredAnno.comment ? (
                <div className="flex items-center gap-1.5 text-amber-200">
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium truncate">{hoveredAnno.comment}</span>
                </div>
              ) : (
                <span className="text-neutral-300 text-[11px]">Klicken zum Bearbeiten / Löschen</span>
              )}
            </div>
          );
        })()
      )}

      {/* ── 3. Interaktives Aktions-Popover bei Klick (Farbe, Deckkraft, Kommentar, Löschen) ── */}
      {selectedAnnotation && menuPosition && (
        <div
          ref={popoverRef}
          className="absolute pointer-events-auto z-[60] bg-neutral-900 border border-neutral-700 rounded-xl p-3 shadow-2xl backdrop-blur-md text-white min-w-[280px] max-w-[340px] animate-in fade-in zoom-in-95 duration-150"
          style={{
            left: `${menuPosition.x}px`,
            top: `${Math.max(10, menuPosition.y - 150)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header mit Textvorschau & Schließen */}
          <div className="flex items-start justify-between gap-2 mb-2.5 pb-2 border-b border-neutral-800">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                Markierung (Seite {selectedAnnotation.pageNumber})
              </div>
              {selectedAnnotation.selectedText && (
                <div className="text-xs text-neutral-300 italic truncate mt-0.5" title={selectedAnnotation.selectedText}>
                  "{selectedAnnotation.selectedText}"
                </div>
              )}
            </div>
            <button
              onClick={() => {
                setSelectedAnnotation(null);
                setActiveAnnotation(null);
              }}
              className="text-neutral-400 hover:text-white p-1 rounded-md hover:bg-neutral-800 transition-colors shrink-0"
              title="Schließen"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Farbauswahl */}
          <div className="flex items-center justify-between gap-1 mb-2.5">
            <span className="text-[11px] text-neutral-400 font-medium">Farbe:</span>
            <div className="flex items-center gap-1.5">
              {HIGHLIGHT_COLORS.map((c) => {
                const isActive = selectedAnnotation.color.toUpperCase() === c.value.toUpperCase();
                return (
                  <button
                    key={c.name}
                    onClick={(e) => handleColorChange(selectedAnnotation, c.value, e)}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-115 flex items-center justify-center ${
                      isActive ? 'ring-2 ring-white ring-offset-1 ring-offset-neutral-900 scale-110' : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={`Farbe auf ${c.label} ändern`}
                  >
                    {isActive && <Check className="w-3 h-3 text-neutral-900 stroke-[3]" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Transparenz / Deckkraft Slider */}
          <div className="mb-3 p-2 rounded-lg bg-neutral-800/60 border border-neutral-700/50">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-1.5">
              <span className="flex items-center gap-1 font-medium">
                <Sliders className="w-3 h-3 text-neutral-400" /> Deckkraft
              </span>
              <span className="font-mono text-neutral-200 text-[11px]">
                {Math.round((selectedAnnotation.opacity ?? highlightOpacity ?? 0.35) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="15"
              max="85"
              step="5"
              value={Math.round((selectedAnnotation.opacity ?? highlightOpacity ?? 0.35) * 100)}
              onChange={(e) => handleOpacityChange(selectedAnnotation, parseInt(e.target.value, 10) / 100)}
              className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>

          {/* Kommentar-Bereich */}
          <div className="mb-3">
            {isEditingComment ? (
              <div className="space-y-2">
                <textarea
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder="Kommentar eingeben..."
                  className="w-full text-xs p-2 rounded-lg bg-neutral-800 border border-neutral-600 text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none h-16"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSaveComment(selectedAnnotation);
                    }
                    if (e.key === 'Escape') {
                      setIsEditingComment(false);
                    }
                  }}
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => setIsEditingComment(false)}
                    className="px-2 py-1 text-[11px] text-neutral-400 hover:text-white rounded hover:bg-neutral-800 transition-colors"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={() => handleSaveComment(selectedAnnotation)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            ) : selectedAnnotation.comment ? (
              <div className="p-2 rounded-lg bg-neutral-800/80 border border-neutral-700/60 text-xs">
                <div className="flex items-center justify-between text-neutral-400 mb-1">
                  <span className="flex items-center gap-1 text-[10px] font-medium text-amber-300">
                    <MessageSquare className="w-3 h-3" /> Kommentar
                  </span>
                  <button
                    onClick={() => setIsEditingComment(true)}
                    className="hover:text-blue-400 p-0.5 rounded transition-colors"
                    title="Kommentar bearbeiten"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-neutral-200 text-xs break-words">{selectedAnnotation.comment}</p>
              </div>
            ) : (
              <button
                onClick={() => setIsEditingComment(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs text-neutral-300 hover:text-white bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/60 rounded-lg transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
                <span>Kommentar hinzufügen</span>
              </button>
            )}
          </div>

          {/* Löschen-Button */}
          <div className="pt-2 border-t border-neutral-800 flex items-center justify-end">
            <button
              onClick={(e) => handleDeleteAnnotation(selectedAnnotation.id, e)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-950/70 border border-red-900/50 rounded-lg transition-all"
              title="Diese Markierung endgültig löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Markierung löschen</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

