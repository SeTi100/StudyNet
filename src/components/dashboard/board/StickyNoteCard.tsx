import React, { useState, useEffect, useRef } from 'react';
import { DashboardCardRecord, db } from '../../../db/schema';
import { Pin, Trash2, Palette, Check } from 'lucide-react';

interface StickyNoteCardProps {
  card: DashboardCardRecord;
  onUpdate: (updated: DashboardCardRecord) => void;
  onDelete: (id: string) => void;
}

export const STICKY_COLORS: { id: string; name: string; bg: string; border: string; accent: string; text: string; dot: string }[] = [
  {
    id: 'yellow',
    name: 'Bernstein / Gelb',
    bg: 'bg-amber-950/40',
    border: 'border-amber-600/40 hover:border-amber-500/70',
    accent: 'text-amber-300',
    text: 'text-amber-100',
    dot: 'bg-amber-400',
  },
  {
    id: 'blue',
    name: 'Himmelblau',
    bg: 'bg-sky-950/40',
    border: 'border-sky-600/40 hover:border-sky-500/70',
    accent: 'text-sky-300',
    text: 'text-sky-100',
    dot: 'bg-sky-400',
  },
  {
    id: 'emerald',
    name: 'Smaragdgrün',
    bg: 'bg-emerald-950/40',
    border: 'border-emerald-600/40 hover:border-emerald-500/70',
    accent: 'text-emerald-300',
    text: 'text-emerald-100',
    dot: 'bg-emerald-400',
  },
  {
    id: 'purple',
    name: 'Violett',
    bg: 'bg-purple-950/40',
    border: 'border-purple-600/40 hover:border-purple-500/70',
    accent: 'text-purple-300',
    text: 'text-purple-100',
    dot: 'bg-purple-400',
  },
  {
    id: 'rose',
    name: 'Rosé',
    bg: 'bg-rose-950/40',
    border: 'border-rose-600/40 hover:border-rose-500/70',
    accent: 'text-rose-300',
    text: 'text-rose-100',
    dot: 'bg-rose-400',
  },
  {
    id: 'orange',
    name: 'Koralle',
    bg: 'bg-orange-950/40',
    border: 'border-orange-600/40 hover:border-orange-500/70',
    accent: 'text-orange-300',
    text: 'text-orange-100',
    dot: 'bg-orange-400',
  },
  {
    id: 'slate',
    name: 'Neutral / Dunkel',
    bg: 'bg-neutral-900/90',
    border: 'border-neutral-700/80 hover:border-neutral-600',
    accent: 'text-neutral-300',
    text: 'text-neutral-100',
    dot: 'bg-neutral-400',
  },
];

export function StickyNoteCard({ card, onUpdate, onDelete }: StickyNoteCardProps) {
  const [title, setTitle] = useState(card.title || '');
  const [content, setContent] = useState(card.content || '');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeColor = STICKY_COLORS.find((c) => c.id === card.color) || STICKY_COLORS[0];

  useEffect(() => {
    setTitle(card.title || '');
    setContent(card.content || '');
  }, [card.title, card.content]);

  // Schließt Color Picker beim Klick außerhalb
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    }
    if (showColorPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showColorPicker]);

  const saveChanges = async (newTitle: string, newContent: string, newColor?: string, newPinned?: boolean) => {
    const updated: DashboardCardRecord = {
      ...card,
      title: newTitle,
      content: newContent,
      color: newColor !== undefined ? newColor : card.color,
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
    saveChanges(title, content, undefined, !card.isPinned);
  };

  const handleSelectColor = (colorId: string) => {
    saveChanges(title, content, colorId);
    setShowColorPicker(false);
  };

  return (
    <div
      className={`relative group rounded-xl p-4 border transition-all duration-200 shadow-md backdrop-blur-sm flex flex-col justify-between ${
        activeColor.bg
      } ${activeColor.border} ${card.isPinned ? 'ring-1 ring-amber-400/50 shadow-amber-950/30' : ''}`}
    >
      {/* Header mit Titel, Pin, Color & Delete */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          placeholder="Titel der Notiz..."
          className={`bg-transparent font-semibold text-sm w-full focus:outline-none placeholder-neutral-500/70 border-b border-transparent focus:border-white/20 transition-colors pb-0.5 ${activeColor.accent}`}
        />

        <div className="flex items-center gap-1 shrink-0">
          {/* Pin Button */}
          <button
            onClick={handleTogglePin}
            className={`p-1 rounded-md transition-colors ${
              card.isPinned
                ? 'text-amber-400 bg-amber-400/20 hover:bg-amber-400/30'
                : 'text-neutral-400 opacity-60 group-hover:opacity-100 hover:text-white hover:bg-white/10'
            }`}
            title={card.isPinned ? 'Notiz loslösen' : 'Oben anpinnen'}
          >
            <Pin className={`w-3.5 h-3.5 ${card.isPinned ? 'rotate-45 fill-amber-400' : ''}`} />
          </button>

          {/* Color Picker Toggle */}
          <div className="relative" ref={colorPickerRef}>
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-1 rounded-md text-neutral-400 opacity-60 group-hover:opacity-100 hover:text-white hover:bg-white/10 transition-colors"
              title="Farbe ändern"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {showColorPicker && (
              <div className="absolute right-0 top-full mt-1.5 p-2 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-30 flex gap-1.5 animate-in fade-in zoom-in-95">
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => handleSelectColor(c.id)}
                    className={`w-6 h-6 rounded-full ${c.dot} flex items-center justify-center transition-transform hover:scale-110 shadow-sm`}
                    title={c.name}
                  >
                    {card.color === c.id && <Check className="w-3.5 h-3.5 text-neutral-950 font-bold" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(card.id)}
            className="p-1 rounded-md text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/50 transition-all"
            title="Notiz löschen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content Textarea */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onBlur={handleContentBlur}
        placeholder="Gedanken, Notizen oder Ideen hier eingeben..."
        rows={4}
        className={`w-full bg-transparent text-xs leading-relaxed focus:outline-none resize-y placeholder-neutral-500/70 ${activeColor.text}`}
      />

      {/* Footer mit Zeitstempel */}
      <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-2 border-t border-white/5 mt-2">
        <span>Haftnotiz</span>
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
  );
}
