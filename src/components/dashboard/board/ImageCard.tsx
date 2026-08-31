import React, { useState } from 'react';
import { DashboardCardRecord, db } from '../../../db/schema';
import { Image as ImageIcon, Pin, Trash2, Maximize2, X, Download } from 'lucide-react';

interface ImageCardProps {
  card: DashboardCardRecord;
  onUpdate: (updated: DashboardCardRecord) => void;
  onDelete: (id: string) => void;
}

export function ImageCard({ card, onUpdate, onDelete }: ImageCardProps) {
  const [title, setTitle] = useState(card.title || '');
  const [content, setContent] = useState(card.content || '');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const saveChanges = async (newTitle: string, newContent: string, newPinned?: boolean) => {
    const updated: DashboardCardRecord = {
      ...card,
      title: newTitle,
      content: newContent,
      isPinned: newPinned !== undefined ? newPinned : card.isPinned,
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.put(updated);
    onUpdate(updated);
  };

  const handleTitleBlur = () => {
    if (title !== (card.title || '')) {
      saveChanges(title, content);
    }
  };

  const handleContentBlur = () => {
    if (content !== (card.content || '')) {
      saveChanges(title, content);
    }
  };

  const handleTogglePin = () => {
    saveChanges(title, content, !card.isPinned);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!card.imageData) return;
    const a = document.createElement('a');
    a.href = card.imageData;
    a.download = card.imageName || `studynet-image-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <div
        className={`relative group rounded-xl p-3 border bg-neutral-900/90 border-neutral-800 transition-all duration-200 shadow-md backdrop-blur-sm flex flex-col justify-between ${
          card.isPinned ? 'ring-1 ring-purple-500/50 shadow-purple-950/30' : 'hover:border-neutral-700'
        }`}
      >
        <div>
          {/* Header */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="p-1 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
                <ImageIcon className="w-3.5 h-3.5" />
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                placeholder="Bildunterschrift / Titel..."
                className="bg-transparent font-medium text-xs text-neutral-100 w-full focus:outline-none placeholder-neutral-500 border-b border-transparent focus:border-neutral-700 pb-0.5"
              />
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleTogglePin}
                className={`p-1 rounded-md transition-colors ${
                  card.isPinned
                    ? 'text-amber-400 bg-amber-400/20 hover:bg-amber-400/30'
                    : 'text-neutral-400 opacity-60 group-hover:opacity-100 hover:text-white hover:bg-white/10'
                }`}
                title={card.isPinned ? 'Bild loslösen' : 'Oben anpinnen'}
              >
                <Pin className={`w-3.5 h-3.5 ${card.isPinned ? 'rotate-45 fill-amber-400' : ''}`} />
              </button>

              <button
                onClick={() => onDelete(card.id)}
                className="p-1 rounded-md text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/50 transition-all"
                title="Bild löschen"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Image Container with Preview */}
          {card.imageData ? (
            <div
              onClick={() => setIsFullscreen(true)}
              className="relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 cursor-pointer group/img max-h-56 flex items-center justify-center"
            >
              <img
                src={card.imageData}
                alt={card.imageName || card.title || 'Pinnwand-Bild'}
                className="w-full h-auto object-cover max-h-56 transition-transform duration-300 group-hover/img:scale-105"
              />
              <div className="absolute inset-0 bg-neutral-950/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <span className="p-2 rounded-full bg-neutral-900/90 text-white shadow-lg border border-neutral-700">
                  <Maximize2 className="w-4 h-4" />
                </span>
              </div>
            </div>
          ) : (
            <div className="h-32 rounded-lg border border-dashed border-neutral-800 bg-neutral-950/50 flex flex-col items-center justify-center text-neutral-500 text-xs">
              <ImageIcon className="w-6 h-6 mb-1 opacity-40" />
              <span>Keine Bilddaten vorhanden</span>
            </div>
          )}

          {/* Optional Caption/Notes Textarea */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={handleContentBlur}
            placeholder="Optionale Notiz zum Bild..."
            rows={1}
            className="w-full bg-transparent text-xs leading-relaxed text-neutral-300 focus:outline-none resize-y placeholder-neutral-600 mt-2"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-2 border-t border-white/5 mt-2">
          <span>Bild</span>
          <span>
            {card.updatedAt
              ? new Date(card.updatedAt).toLocaleDateString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </span>
        </div>
      </div>

      {/* Fullscreen Lightbox Modal */}
      {isFullscreen && card.imageData && (
        <div
          onClick={() => setIsFullscreen(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl max-h-[90vh] flex flex-col items-center gap-3"
          >
            {/* Top Toolbar */}
            <div className="w-full flex items-center justify-between text-white">
              <span className="text-sm font-semibold truncate max-w-md">
                {card.title || card.imageName || 'Bildansicht'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
                  title="Bild herunterladen"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
                  title="Schließen"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Image */}
            <div className="overflow-auto rounded-xl border border-neutral-800 bg-neutral-950 p-1 flex items-center justify-center">
              <img
                src={card.imageData}
                alt={card.imageName || card.title || 'Pinnwand-Bild'}
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
              />
            </div>

            {/* Caption */}
            {card.content && (
              <p className="text-xs text-neutral-300 bg-neutral-900/90 px-4 py-2 rounded-lg border border-neutral-800 max-w-2xl text-center">
                {card.content}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
