import React, { useState, useEffect, useRef } from 'react';
import { getFromOPFS } from '../../utils/opfsStorage';
import {
  RotateCw,
  RotateCcw,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Copy,
  Download,
  Trash2,
  ArrowUp,
  ArrowDown,
  Check,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X
} from 'lucide-react';

interface NoteImageProps {
  src?: string;
  alt?: string;
  onUpdateParams?: (oldSrc: string, newParams: { width?: number; rotate?: number; align?: 'left' | 'center' | 'right' }) => void;
  onDelete?: (src: string) => void;
  onMoveBlock?: (src: string, direction: 'up' | 'down') => void;
  isEditable?: boolean;
}

interface ParsedImageParams {
  baseUrl: string;
  scalePercent: number; // 25% to 250%
  rotate: number; // 0, 90, 180, 270
  align: 'left' | 'center' | 'right';
}

// Global cache for OPFS Object URLs so re-renders don't re-fetch or flicker
const opfsBlobCache = new Map<string, string>();

function parseImageParams(rawSrc: string): ParsedImageParams {
  if (!rawSrc) return { baseUrl: '', scalePercent: 100, rotate: 0, align: 'center' };

  let baseUrl = rawSrc;
  let hashOrQuery = '';

  const hashIndex = rawSrc.indexOf('#');
  if (hashIndex !== -1) {
    baseUrl = rawSrc.substring(0, hashIndex);
    hashOrQuery = rawSrc.substring(hashIndex + 1);
  } else {
    const queryIndex = rawSrc.indexOf('?');
    if (queryIndex !== -1) {
      baseUrl = rawSrc.substring(0, queryIndex);
      hashOrQuery = rawSrc.substring(queryIndex + 1);
    }
  }

  const params = new URLSearchParams(hashOrQuery);
  const widthStr = params.get('w') || params.get('width');
  let scalePercent = 100;
  if (widthStr) {
    const val = parseInt(widthStr, 10);
    // If stored as percentage (e.g. 25, 50, 100, 150, 200)
    if (val >= 25 && val <= 250) {
      scalePercent = val;
    } else if (val > 250) {
      // Legacy pixel value
      scalePercent = Math.min(250, Math.max(25, Math.round((val / 600) * 100)));
    }
  }

  const rotStr = params.get('r') || params.get('rotate') || params.get('rot');
  const rotate = rotStr ? parseInt(rotStr, 10) % 360 : 0;

  const alignRaw = (params.get('align') || params.get('a') || 'center').toLowerCase();
  const align: 'left' | 'center' | 'right' =
    alignRaw === 'left' || alignRaw === 'right' ? alignRaw : 'center';

  return { baseUrl, scalePercent, rotate, align };
}

export const NoteImage: React.FC<NoteImageProps> = ({
  src = '',
  alt = 'Image snippet',
  onUpdateParams,
  onDelete,
  onMoveBlock,
  isEditable = true,
}) => {
  const { baseUrl, scalePercent, rotate, align } = parseImageParams(src);
  const cleanUrl = baseUrl ? decodeURIComponent(baseUrl) : '';

  const [blobUrl, setBlobUrl] = useState<string | null>(() => {
    if (!cleanUrl) return null;
    if (cleanUrl.startsWith('opfs://')) {
      return opfsBlobCache.get(cleanUrl) || null;
    }
    return cleanUrl;
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (!cleanUrl) return false;
    if (cleanUrl.startsWith('opfs://')) {
      return !opfsBlobCache.has(cleanUrl);
    }
    return false;
  });

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(false);
  const [showFullscreenModal, setShowFullscreenModal] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load image from OPFS or regular source once per unique file
  useEffect(() => {
    let active = true;

    async function loadImage() {
      if (!cleanUrl) return;

      if (cleanUrl.startsWith('opfs://')) {
        if (opfsBlobCache.has(cleanUrl)) {
          setBlobUrl(opfsBlobCache.get(cleanUrl)!);
          setLoading(false);
          return;
        }

        setLoading(true);
        setLoadError(null);
        try {
          const file = await getFromOPFS(cleanUrl);
          if (!active) return;
          const createdUrl = URL.createObjectURL(file);
          opfsBlobCache.set(cleanUrl, createdUrl);
          setBlobUrl(createdUrl);
        } catch (err: any) {
          console.error('Failed to load image from OPFS:', err);
          if (active) {
            setLoadError('Bild konnte nicht aus dem OPFS geladen werden.');
          }
        } finally {
          if (active) setLoading(false);
        }
      } else {
        setBlobUrl(cleanUrl);
        setLoading(false);
      }
    }

    loadImage();

    return () => {
      active = false;
    };
  }, [cleanUrl]);

  // Update image transformation parameters (allows up to 250% zoom)
  const updateTransform = (newScale?: number, newRotate?: number, newAlign?: 'left' | 'center' | 'right') => {
    if (!onUpdateParams) return;

    const finalScale = newScale !== undefined ? Math.min(250, Math.max(25, newScale)) : scalePercent;
    const finalRotate = newRotate !== undefined ? (newRotate + 360) % 360 : rotate;
    const finalAlign = newAlign !== undefined ? newAlign : align;

    onUpdateParams(src, {
      width: finalScale,
      rotate: finalRotate,
      align: finalAlign,
    });
  };

  const handleCopy = async () => {
    if (!blobUrl) return;
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy note image to clipboard:', err);
    }
  };

  const handleDownload = () => {
    if (!blobUrl) return;
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `studynet_snippet_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const alignmentClass =
    align === 'left'
      ? 'items-start text-left'
      : align === 'right'
      ? 'items-end text-right'
      : 'items-center text-center';

  return (
    <>
      <div
        ref={containerRef}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        className={`relative my-4 flex flex-col w-full max-w-full ${alignmentClass}`}
      >
        {/* Floating Toolbar */}
        {isEditable && (
          <div
            className={`mb-2 flex flex-wrap items-center gap-1 p-1 bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-lg shadow-xl text-neutral-300 text-xs transition-opacity duration-150 z-10 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Rotate Controls */}
            <div className="flex items-center gap-0.5 border-r border-neutral-700 pr-1">
              <button
                type="button"
                onClick={() => updateTransform(undefined, rotate - 90, undefined)}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="90° gegen den Uhrzeigersinn drehen"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateTransform(undefined, rotate + 90, undefined)}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="90° im Uhrzeigersinn drehen"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {rotate !== 0 && (
                <span className="text-[10px] font-mono text-neutral-400 px-1">{rotate}°</span>
              )}
            </div>

            {/* Scale / Zoom Controls (25% bis 200%+) */}
            <div className="flex items-center gap-0.5 border-r border-neutral-700 pr-1">
              <button
                type="button"
                onClick={() => updateTransform(scalePercent - 25, undefined, undefined)}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="Bild verkleinern (-25%)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateTransform(scalePercent + 25, undefined, undefined)}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="Bild vergrößern (+25%)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateTransform(50, undefined, undefined)}
                className={`px-1.5 py-0.5 text-[10px] rounded hover:bg-neutral-800 transition-colors ${
                  scalePercent === 50 ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400'
                }`}
                title="50% (Halbe Spalte)"
              >
                50%
              </button>
              <button
                type="button"
                onClick={() => updateTransform(100, undefined, undefined)}
                className={`px-1.5 py-0.5 text-[10px] rounded hover:bg-neutral-800 transition-colors ${
                  scalePercent === 100 ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400'
                }`}
                title="100% (Standard)"
              >
                100%
              </button>
              <button
                type="button"
                onClick={() => updateTransform(150, undefined, undefined)}
                className={`px-1.5 py-0.5 text-[10px] rounded hover:bg-neutral-800 transition-colors ${
                  scalePercent === 150 ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400'
                }`}
                title="150% (Vergrößert)"
              >
                150%
              </button>
              <button
                type="button"
                onClick={() => updateTransform(200, undefined, undefined)}
                className={`px-1.5 py-0.5 text-[10px] rounded hover:bg-neutral-800 transition-colors ${
                  scalePercent === 200 ? 'bg-neutral-700 text-white font-medium' : 'text-neutral-400'
                }`}
                title="200% (Doppelt groß)"
              >
                200%
              </button>
            </div>

            {/* Alignment Controls */}
            <div className="flex items-center gap-0.5 border-r border-neutral-700 pr-1">
              <button
                type="button"
                onClick={() => updateTransform(undefined, undefined, 'left')}
                className={`p-1.5 rounded hover:bg-neutral-800 hover:text-white transition-colors ${
                  align === 'left' ? 'bg-neutral-750 text-blue-400 font-medium' : 'text-neutral-400'
                }`}
                title="Linksbündig ausrichten"
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateTransform(undefined, undefined, 'center')}
                className={`p-1.5 rounded hover:bg-neutral-800 hover:text-white transition-colors ${
                  align === 'center' ? 'bg-neutral-750 text-blue-400 font-medium' : 'text-neutral-400'
                }`}
                title="Zentrieren"
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => updateTransform(undefined, undefined, 'right')}
                className={`p-1.5 rounded hover:bg-neutral-800 hover:text-white transition-colors ${
                  align === 'right' ? 'bg-neutral-750 text-blue-400 font-medium' : 'text-neutral-400'
                }`}
                title="Rechtsbündig ausrichten"
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Move Up / Down in Text */}
            {onMoveBlock && (
              <div className="flex items-center gap-0.5 border-r border-neutral-700 pr-1">
                <button
                  type="button"
                  onClick={() => onMoveBlock(src, 'up')}
                  className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                  title="Bildblock in Notiz nach oben verschieben"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onMoveBlock(src, 'down')}
                  className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                  title="Bildblock in Notiz nach unten verschieben"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Fullscreen / Lightbox Zoom */}
            <div className="flex items-center gap-0.5 border-r border-neutral-700 pr-1">
              <button
                type="button"
                onClick={() => setShowFullscreenModal(true)}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="Vollbild-Vorschau / Detailansicht"
              >
                <Maximize2 className="w-3.5 h-3.5 text-neutral-400" />
              </button>
            </div>

            {/* Copy, Download, Delete Actions */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="Bild in Zwischenablage kopieren"
              >
                {isCopied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-neutral-400" />
                )}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="p-1.5 hover:bg-neutral-800 hover:text-white rounded transition-colors"
                title="Bild als PNG herunterladen"
              >
                <Download className="w-3.5 h-3.5 text-neutral-400" />
              </button>
              {onDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(src)}
                  className="p-1.5 hover:bg-red-950/60 hover:text-red-400 text-neutral-400 rounded transition-colors"
                  title="Bild aus Notiz entfernen"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Image Display Container with horizontal scroll for >100% enlargement */}
        {loading ? (
          <div className="flex items-center justify-center p-8 bg-neutral-900 border border-neutral-800 rounded-lg min-w-[200px]">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            <span className="ml-2 text-xs text-neutral-400">Lade Snippet...</span>
          </div>
        ) : loadError ? (
          <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-300">
            {loadError}
          </div>
        ) : blobUrl ? (
          <div
            className={`w-full max-w-full ${scalePercent > 100 ? 'overflow-x-auto pb-1' : 'overflow-hidden'} flex ${
              align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center'
            }`}
          >
            <div
              className="relative inline-flex items-center justify-center transition-all duration-200 shrink-0 cursor-zoom-in"
              style={{
                width: `${scalePercent}%`,
                maxWidth: scalePercent <= 100 ? '100%' : undefined,
              }}
              onClick={() => setShowFullscreenModal(true)}
              title="Klick für Vollbild-Detailansicht"
            >
              <img
                src={blobUrl}
                alt={alt}
                style={{
                  transform: rotate ? `rotate(${rotate}deg)` : undefined,
                  transition: 'transform 0.2s ease',
                  width: '100%',
                  height: 'auto',
                }}
                className="rounded-lg border border-neutral-700 shadow-md bg-neutral-900 object-contain"
                loading="lazy"
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Lightbox / Fullscreen Modal for High-Res Zoom */}
      {showFullscreenModal && blobUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setShowFullscreenModal(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-3 flex flex-col items-center gap-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header Bar */}
            <div className="w-full flex items-center justify-between border-b border-neutral-800 pb-2">
              <span className="text-xs font-semibold text-neutral-300">{alt}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md flex items-center gap-1.5 transition-colors border border-neutral-700"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-400" />}
                  <span>Kopieren</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-2.5 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-md flex items-center gap-1.5 transition-colors border border-neutral-700"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Download</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFullscreenModal(false)}
                  className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                  title="Schließen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Image Display */}
            <div className="overflow-auto max-h-[75vh] flex items-center justify-center p-2">
              <img
                src={blobUrl}
                alt={alt}
                style={{
                  transform: rotate ? `rotate(${rotate}deg)` : undefined,
                  maxHeight: '70vh',
                }}
                className="rounded-lg object-contain border border-neutral-800 shadow-2xl"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
