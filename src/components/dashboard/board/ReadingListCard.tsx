import React, { useState } from 'react';
import { DashboardCardRecord, ReadingListItem, db, DocumentRecord } from '../../../db/schema';
import { useDocumentStore } from '../../../store/useDocumentStore';
import {
  BookOpen,
  Pin,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  Circle,
  ExternalLink,
  Sparkles,
  X,
} from 'lucide-react';

interface ReadingListCardProps {
  card: DashboardCardRecord;
  onUpdate: (updated: DashboardCardRecord) => void;
  onDelete: (id: string) => void;
}

const PRIORITY_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  next: { label: 'Als Nächstes', bg: 'bg-amber-500/20 border-amber-500/40', text: 'text-amber-300' },
  high: { label: 'Hohe Prio', bg: 'bg-red-500/20 border-red-500/40', text: 'text-red-300' },
  medium: { label: 'Standard', bg: 'bg-blue-500/20 border-blue-500/40', text: 'text-blue-300' },
  low: { label: 'Optional', bg: 'bg-neutral-800 border-neutral-700', text: 'text-neutral-400' },
};

export function ReadingListCard({ card, onUpdate, onDelete }: ReadingListCardProps) {
  const { documents } = useDocumentStore();
  const [title, setTitle] = useState(card.title || 'Paper-Lesereihenfolge');
  const [items, setItems] = useState<ReadingListItem[]>(card.readingItems || []);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [customTitle, setCustomTitle] = useState('');
  const [itemNote, setItemNote] = useState('');
  const [itemPriority, setItemPriority] = useState<'next' | 'high' | 'medium' | 'low'>('next');
  const [isAdding, setIsAdding] = useState(false);

  const saveChanges = async (newTitle: string, newItems: ReadingListItem[], newPinned?: boolean) => {
    const updated: DashboardCardRecord = {
      ...card,
      title: newTitle,
      readingItems: newItems,
      isPinned: newPinned !== undefined ? newPinned : card.isPinned,
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.put(updated);
    onUpdate(updated);
  };

  const handleTitleBlur = () => {
    if (title !== (card.title || '')) {
      saveChanges(title, items);
    }
  };

  const handleTogglePin = () => {
    saveChanges(title, items, !card.isPinned);
  };

  const handleAddItem = () => {
    let paperTitle = customTitle.trim();
    let docId: string | undefined = undefined;

    if (selectedDocId) {
      const doc = documents.find((d) => d.id === selectedDocId);
      if (doc) {
        paperTitle = doc.title;
        docId = doc.id;
      }
    }

    if (!paperTitle) return;

    const newItem: ReadingListItem = {
      id: crypto.randomUUID(),
      documentId: docId,
      title: paperTitle,
      note: itemNote.trim() || undefined,
      priority: itemPriority,
      isDone: false,
    };

    const newItems = [...items, newItem];
    setItems(newItems);
    saveChanges(title, newItems);

    // Reset Form
    setSelectedDocId('');
    setCustomTitle('');
    setItemNote('');
    setItemPriority('next');
    setIsAdding(false);
  };

  const handleToggleItemDone = (itemId: string) => {
    const newItems = items.map((it) => (it.id === itemId ? { ...it, isDone: !it.isDone } : it));
    setItems(newItems);
    saveChanges(title, newItems);
  };

  const handleDeleteItem = (itemId: string) => {
    const newItems = items.filter((it) => it.id !== itemId);
    setItems(newItems);
    saveChanges(title, newItems);
  };

  const handleMoveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const newItems = [...items];
    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);

    setItems(newItems);
    saveChanges(title, newItems);
  };

  const completedCount = items.filter((i) => i.isDone).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div
      className={`relative group rounded-xl p-4 border bg-neutral-900/90 border-neutral-800 transition-all duration-200 shadow-md backdrop-blur-sm flex flex-col justify-between ${
        card.isPinned ? 'ring-1 ring-blue-500/50 shadow-blue-950/30' : 'hover:border-neutral-700'
      }`}
    >
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Paper-Lesereihenfolge..."
              className="bg-transparent font-semibold text-sm text-neutral-100 w-full focus:outline-none placeholder-neutral-500 border-b border-transparent focus:border-neutral-700 pb-0.5"
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
              title={card.isPinned ? 'Leseliste loslösen' : 'Oben anpinnen'}
            >
              <Pin className={`w-3.5 h-3.5 ${card.isPinned ? 'rotate-45 fill-amber-400' : ''}`} />
            </button>

            <button
              onClick={() => onDelete(card.id)}
              className="p-1 rounded-md text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/50 transition-all"
              title="Leseliste löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {totalCount > 0 && (
          <div className="mb-3 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>
                {completedCount} von {totalCount} Papers gelesen
              </span>
              <span className="font-mono text-blue-400 font-semibold">{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* List of Papers */}
        <div className="space-y-2 mb-3">
          {items.length === 0 && !isAdding && (
            <p className="text-xs text-neutral-500 py-3 text-center border border-dashed border-neutral-800 rounded-lg">
              Noch keine Papers in dieser Leseliste. Klicke unten auf "+ Paper hinzufügen".
            </p>
          )}

          {items.map((item, index) => {
            const prio = PRIORITY_STYLES[item.priority || 'medium'];
            return (
              <div
                key={item.id}
                className={`group/item flex items-start justify-between gap-2 p-2.5 rounded-lg border transition-all ${
                  item.isDone
                    ? 'bg-neutral-950/50 border-neutral-800/60 opacity-60'
                    : 'bg-neutral-950 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                {/* Reorder Buttons & Checkbox */}
                <div className="flex items-center gap-1.5 pt-0.5 shrink-0">
                  <div className="flex flex-col -space-y-1">
                    <button
                      onClick={() => handleMoveItem(index, 'up')}
                      disabled={index === 0}
                      className="text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
                      title="Nach oben verschieben"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMoveItem(index, 'down')}
                      disabled={index === items.length - 1}
                      className="text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
                      title="Nach unten verschieben"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <span className="text-[11px] font-mono font-bold text-neutral-500 w-4 text-center">
                    {index + 1}.
                  </span>

                  <button
                    onClick={() => handleToggleItemDone(item.id)}
                    className="text-neutral-400 hover:text-emerald-400 transition-colors"
                  >
                    {item.isDone ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {item.documentId ? (
                      <a
                        href={`#doc=${item.documentId}`}
                        className={`text-xs font-semibold hover:underline flex items-center gap-1 group-hover/item:text-blue-400 transition-colors ${
                          item.isDone ? 'line-through text-neutral-400' : 'text-neutral-100'
                        }`}
                        title="Paper im Reader öffnen"
                      >
                        <span className="truncate">{item.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 opacity-60 group-hover/item:opacity-100" />
                      </a>
                    ) : (
                      <span
                        className={`text-xs font-medium ${
                          item.isDone ? 'line-through text-neutral-400' : 'text-neutral-200'
                        }`}
                      >
                        {item.title}
                      </span>
                    )}

                    {item.priority && (
                      <span
                        className={`px-1.5 py-0.2 rounded border text-[9px] font-semibold uppercase tracking-wider ${prio.bg} ${prio.text}`}
                      >
                        {prio.label}
                      </span>
                    )}
                  </div>

                  {item.note && (
                    <p className="text-[11px] text-neutral-400 mt-0.5 italic line-clamp-2">
                      {item.note}
                    </p>
                  )}
                </div>

                {/* Delete Item */}
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  className="p-1 text-neutral-500 opacity-0 group-hover/item:opacity-100 hover:text-red-400 transition-all shrink-0"
                  title="Aus Leseliste entfernen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Add Paper Form / Toggle */}
        {isAdding ? (
          <div className="bg-neutral-950 border border-blue-500/30 rounded-xl p-3 space-y-2.5 animate-in fade-in zoom-in-95">
            <div className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Paper zur Leseliste hinzufügen</span>
            </div>

            {/* Select from imported documents */}
            {documents.length > 0 && (
              <div>
                <label className="block text-[10px] text-neutral-400 uppercase font-semibold mb-1">
                  Aus Bibliothek wählen:
                </label>
                <select
                  value={selectedDocId}
                  onChange={(e) => {
                    setSelectedDocId(e.target.value);
                    if (e.target.value) setCustomTitle('');
                  }}
                  className="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs rounded-lg p-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="">-- Wähle ein Paper aus --</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Custom Title Input */}
            <div>
              <label className="block text-[10px] text-neutral-400 uppercase font-semibold mb-1">
                Oder Titel / Thema manuell eingeben:
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => {
                  setCustomTitle(e.target.value);
                  if (e.target.value) setSelectedDocId('');
                }}
                placeholder="z.B. Attention Is All You Need (Vaswani et al.)"
                className="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs rounded-lg p-2 focus:outline-none focus:border-blue-500 placeholder-neutral-600"
              />
            </div>

            {/* Priority & Reason Note */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-neutral-400 uppercase font-semibold mb-1">
                  Priorität:
                </label>
                <select
                  value={itemPriority}
                  onChange={(e) => setItemPriority(e.target.value as any)}
                  className="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs rounded-lg p-2 focus:outline-none focus:border-blue-500"
                >
                  <option value="next">Als Nächstes</option>
                  <option value="high">Hohe Priorität</option>
                  <option value="medium">Standard</option>
                  <option value="low">Optional</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-neutral-400 uppercase font-semibold mb-1">
                  Notiz / Leseziel:
                </label>
                <input
                  type="text"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="z.B. Für Kapitel 2 Methodik"
                  className="w-full bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs rounded-lg p-2 focus:outline-none focus:border-blue-500 placeholder-neutral-600"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={handleAddItem}
                disabled={!selectedDocId && !customTitle.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Hinzufügen
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full py-2 px-3 border border-dashed border-neutral-700/80 hover:border-blue-500/60 bg-neutral-950/40 hover:bg-neutral-900 rounded-lg text-xs font-medium text-neutral-300 hover:text-blue-300 flex items-center justify-center gap-1.5 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            Paper zur Leseliste hinzufügen
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-2 border-t border-white/5 mt-3">
        <span>Paper-Leseliste</span>
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
