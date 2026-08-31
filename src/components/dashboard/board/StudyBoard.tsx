import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, DashboardCardRecord, DashboardCardType } from '../../../db/schema';
import { StickyNoteCard } from './StickyNoteCard';
import { ReadingListCard } from './ReadingListCard';
import { ChecklistCard } from './ChecklistCard';
import { ReminderCard } from './ReminderCard';
import { ImageCard } from './ImageCard';
import {
  LayoutDashboard,
  Plus,
  StickyNote,
  BookOpen,
  CheckSquare,
  Calendar,
  Image as ImageIcon,
  Filter,
  Sparkles,
  Pin,
  Upload,
} from 'lucide-react';

type FilterType = 'all' | 'sticky' | 'reading_list' | 'reminder' | 'checklist' | 'image';

export function StudyBoard() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Live Query aus Dexie
  const cards = useLiveQuery(
    async () => {
      const all = await db.dashboardCards.toArray();
      // Sortiere: Angepinnte zuerst, dann nach Aktualisierungsdatum absteigend
      return all.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
      });
    },
    [],
    []
  );

  // ── Neue Karten erstellen ──────────────────────────────────────────────────
  const createStickyNote = async (color = 'yellow') => {
    const newCard: DashboardCardRecord = {
      id: crypto.randomUUID(),
      type: 'sticky',
      title: 'Neue Notiz',
      content: '',
      color,
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.add(newCard);
  };

  const createReadingList = async () => {
    const newCard: DashboardCardRecord = {
      id: crypto.randomUUID(),
      type: 'reading_list',
      title: 'Paper-Lesereihenfolge',
      readingItems: [],
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.add(newCard);
  };

  const createChecklist = async () => {
    const newCard: DashboardCardRecord = {
      id: crypto.randomUUID(),
      type: 'checklist',
      title: 'To-Do Liste',
      checklistItems: [],
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.add(newCard);
  };

  const createReminder = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().slice(0, 10);

    const newCard: DashboardCardRecord = {
      id: crypto.randomUUID(),
      type: 'reminder',
      title: 'Wichtiger Termin / Frist',
      content: '',
      dueDate: dateStr,
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.add(newCard);
  };

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Bitte eine Bilddatei auswählen (PNG, JPG, WebP, etc.)');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const newCard: DashboardCardRecord = {
        id: crypto.randomUUID(),
        type: 'image',
        title: file.name.replace(/\.[^/.]+$/, ''),
        content: '',
        imageData: dataUrl,
        imageName: file.name,
        isPinned: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        syncUpdatedAt: Date.now(),
      };
      await db.dashboardCards.add(newCard);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageFile(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Drag and Drop für Bilder ──────────────────────────────────────────────
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleImageFile(files[0]);
    }
  };

  // ── Clipboard Paste Listener (Strg+V für Screenshots & Bilder) ───────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            handleImageFile(blob);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleImageFile]);

  // ── Update & Delete Handlers ──────────────────────────────────────────────
  const handleCardUpdate = async (updated: DashboardCardRecord) => {
    await db.dashboardCards.put(updated);
  };

  const handleCardDelete = async (id: string) => {
    await db.dashboardCards.delete(id);
  };

  // ── Filterung ─────────────────────────────────────────────────────────────
  const displayedCards = (cards || []).filter((c) => {
    if (filter === 'all') return true;
    return c.type === filter;
  });

  const pinnedCount = (cards || []).filter((c) => c.isPinned).length;

  return (
    <div
      ref={boardRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col bg-neutral-900/40 border border-neutral-800/90 rounded-2xl p-4 md:p-5 transition-colors ${
        isDragOver ? 'border-purple-500 bg-purple-950/20 ring-2 ring-purple-500/30' : ''
      }`}
    >
      {/* Hidden File Input for Image Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        accept="image/*"
        className="hidden"
      />

      {/* Header: Title, Counts & Quick Actions */}
      <div className="flex flex-col gap-3 pb-4 border-b border-neutral-800">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30 text-purple-400">
              <LayoutDashboard className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base md:text-lg font-bold text-neutral-100 flex items-center gap-2">
                <span>Study Board & Pinnwand</span>
                {pinnedCount > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">
                    <Pin className="w-2.5 h-2.5 rotate-45 fill-amber-400" />
                    {pinnedCount}
                  </span>
                )}
              </h2>
              <p className="text-xs text-neutral-400">
                Haftnotizen, Lesereihenfolge, Termine, To-Dos & Screenshots
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => createStickyNote('yellow')}
              className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Neue Haftnotiz anlegen"
            >
              <StickyNote className="w-3.5 h-3.5" />
              <span>+ Notiz</span>
            </button>

            <button
              onClick={createReadingList}
              className="px-2.5 py-1.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Neue Paper-Leseliste anlegen"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>+ Leseliste</span>
            </button>

            <button
              onClick={createReminder}
              className="px-2.5 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Neuen Termin / Frist anlegen"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>+ Termin</span>
            </button>

            <button
              onClick={createChecklist}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Neue Checkliste anlegen"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>+ To-Do</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
              title="Bild oder Screenshot hochladen (oder Strg+V drücken)"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>+ Bild</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-neutral-500 flex items-center gap-1 shrink-0 mr-1">
            <Filter className="w-3 h-3" /> Filter:
          </span>

          <button
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-neutral-800 text-neutral-100 font-semibold border border-neutral-700'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            Alle ({cards?.length || 0})
          </button>

          <button
            onClick={() => setFilter('sticky')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'sticky'
                ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            Haftnotizen
          </button>

          <button
            onClick={() => setFilter('reading_list')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'reading_list'
                ? 'bg-blue-500/20 text-blue-300 font-semibold border border-blue-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            Leseliste
          </button>

          <button
            onClick={() => setFilter('reminder')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'reminder'
                ? 'bg-orange-500/20 text-orange-300 font-semibold border border-orange-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            Termine
          </button>

          <button
            onClick={() => setFilter('checklist')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'checklist'
                ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            To-Dos
          </button>

          <button
            onClick={() => setFilter('image')}
            className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap ${
              filter === 'image'
                ? 'bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/40'
                : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
            }`}
          >
            Bilder
          </button>
        </div>
      </div>

      {/* Drag & Drop Overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 bg-purple-950/80 border-2 border-dashed border-purple-400 rounded-2xl flex flex-col items-center justify-center gap-2 backdrop-blur-sm animate-in fade-in">
          <Upload className="w-10 h-10 text-purple-300 animate-bounce" />
          <p className="text-sm font-bold text-white">Bild hier ablegen zum Einfügen</p>
        </div>
      )}

      {/* Cards Content List */}
      <div className="pt-4">
        {displayedCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4 border border-dashed border-neutral-800 rounded-xl bg-neutral-950/30">
            <div className="p-3 rounded-full bg-neutral-900 border border-neutral-800 mb-3 text-neutral-400">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <h3 className="text-sm font-semibold text-neutral-300 mb-1">
              Dein Study Board ist noch leer
            </h3>
            <p className="text-xs text-neutral-500 max-w-sm mb-4">
              Erstelle farbige Haftnotizen, organisiere deine Paper-Lesereihenfolge, setze Termine &
              Fristen oder füge Screenshots und To-Dos ein.
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center">
              <button
                onClick={() => createStickyNote('yellow')}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
              >
                + Erste Haftnotiz
              </button>
              <button
                onClick={createReadingList}
                className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/30 transition-colors"
              >
                + Paper-Leseliste
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-semibold hover:bg-purple-500/30 transition-colors"
              >
                + Bild / Screenshot
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayedCards.map((card) => {
              if (card.type === 'sticky') {
                return (
                  <StickyNoteCard
                    key={card.id}
                    card={card}
                    onUpdate={handleCardUpdate}
                    onDelete={handleCardDelete}
                  />
                );
              }
              if (card.type === 'reading_list') {
                return (
                  <div key={card.id} className="md:col-span-2">
                    <ReadingListCard
                      card={card}
                      onUpdate={handleCardUpdate}
                      onDelete={handleCardDelete}
                    />
                  </div>
                );
              }
              if (card.type === 'checklist') {
                return (
                  <ChecklistCard
                    key={card.id}
                    card={card}
                    onUpdate={handleCardUpdate}
                    onDelete={handleCardDelete}
                  />
                );
              }
              if (card.type === 'reminder') {
                return (
                  <ReminderCard
                    key={card.id}
                    card={card}
                    onUpdate={handleCardUpdate}
                    onDelete={handleCardDelete}
                  />
                );
              }
              if (card.type === 'image') {
                return (
                  <ImageCard
                    key={card.id}
                    card={card}
                    onUpdate={handleCardUpdate}
                    onDelete={handleCardDelete}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
