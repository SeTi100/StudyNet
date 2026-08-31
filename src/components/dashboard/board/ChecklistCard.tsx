import React, { useState } from 'react';
import { DashboardCardRecord, ChecklistItem, db } from '../../../db/schema';
import { CheckSquare, Pin, Trash2, Plus, CheckCircle2, Circle, X } from 'lucide-react';

interface ChecklistCardProps {
  card: DashboardCardRecord;
  onUpdate: (updated: DashboardCardRecord) => void;
  onDelete: (id: string) => void;
}

export function ChecklistCard({ card, onUpdate, onDelete }: ChecklistCardProps) {
  const [title, setTitle] = useState(card.title || 'Checkliste');
  const [items, setItems] = useState<ChecklistItem[]>(card.checklistItems || []);
  const [newItemText, setNewItemText] = useState('');

  const saveChanges = async (newTitle: string, newItems: ChecklistItem[], newPinned?: boolean) => {
    const updated: DashboardCardRecord = {
      ...card,
      title: newTitle,
      checklistItems: newItems,
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

  const handleAddItem = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newItemText.trim()) return;

    const newItem: ChecklistItem = {
      id: crypto.randomUUID(),
      text: newItemText.trim(),
      isDone: false,
    };

    const newItems = [...items, newItem];
    setItems(newItems);
    saveChanges(title, newItems);
    setNewItemText('');
  };

  const handleToggleDone = (id: string) => {
    const newItems = items.map((it) => (it.id === id ? { ...it, isDone: !it.isDone } : it));
    setItems(newItems);
    saveChanges(title, newItems);
  };

  const handleDeleteItem = (id: string) => {
    const newItems = items.filter((it) => it.id !== id);
    setItems(newItems);
    saveChanges(title, newItems);
  };

  const completedCount = items.filter((i) => i.isDone).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div
      className={`relative group rounded-xl p-4 border bg-neutral-900/90 border-neutral-800 transition-all duration-200 shadow-md backdrop-blur-sm flex flex-col justify-between ${
        card.isPinned ? 'ring-1 ring-emerald-500/50 shadow-emerald-950/30' : 'hover:border-neutral-700'
      }`}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
              <CheckSquare className="w-4 h-4" />
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Checkliste..."
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
              title={card.isPinned ? 'Checkliste loslösen' : 'Oben anpinnen'}
            >
              <Pin className={`w-3.5 h-3.5 ${card.isPinned ? 'rotate-45 fill-amber-400' : ''}`} />
            </button>

            <button
              onClick={() => onDelete(card.id)}
              className="p-1 rounded-md text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/50 transition-all"
              title="Checkliste löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress */}
        {totalCount > 0 && (
          <div className="mb-3 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-neutral-400 font-medium">
              <span>
                {completedCount} von {totalCount} erledigt
              </span>
              <span className="font-mono text-emerald-400 font-semibold">{progressPercent}%</span>
            </div>
            <div className="h-1.5 w-full bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div
                className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Items List */}
        <div className="space-y-1.5 mb-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`group/item flex items-center justify-between gap-2 p-2 rounded-lg border transition-all ${
                item.isDone
                  ? 'bg-neutral-950/40 border-neutral-900 text-neutral-500'
                  : 'bg-neutral-950 border-neutral-800/80 text-neutral-200 hover:border-neutral-700'
              }`}
            >
              <button
                onClick={() => handleToggleDone(item.id)}
                className="text-neutral-400 hover:text-emerald-400 transition-colors shrink-0"
              >
                {item.isDone ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Circle className="w-4 h-4" />
                )}
              </button>

              <span
                className={`text-xs flex-1 min-w-0 select-text ${
                  item.isDone ? 'line-through text-neutral-500' : 'text-neutral-200'
                }`}
              >
                {item.text}
              </span>

              <button
                onClick={() => handleDeleteItem(item.id)}
                className="p-1 text-neutral-500 opacity-0 group-hover/item:opacity-100 hover:text-red-400 transition-all shrink-0"
                title="Eintrag löschen"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Add Input */}
        <form onSubmit={handleAddItem} className="flex items-center gap-1.5">
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Aufgabe hinzufügen (Enter)..."
            className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:border-emerald-500/70 placeholder-neutral-600"
          />
          <button
            type="submit"
            disabled={!newItemText.trim()}
            className="p-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors shrink-0"
            title="Hinzufügen"
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-2 border-t border-white/5 mt-3">
        <span>Checkliste</span>
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
