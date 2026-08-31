import React, { useState } from 'react';
import { DashboardCardRecord, db } from '../../../db/schema';
import { Calendar, Clock, Pin, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ReminderCardProps {
  card: DashboardCardRecord;
  onUpdate: (updated: DashboardCardRecord) => void;
  onDelete: (id: string) => void;
}

export function formatDueDateBadge(dateString?: string): { label: string; bg: string; text: string; isOverdue: boolean } {
  if (!dateString) return { label: 'Kein Datum', bg: 'bg-neutral-800', text: 'text-neutral-400', isOverdue: false };

  const due = new Date(dateString);
  const now = new Date();

  // Reset hours to compare calendar days
  const dueDateOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = dueDateOnly.getTime() - todayDateOnly.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      label: `Überfällig (${Math.abs(diffDays)} T.)`,
      bg: 'bg-red-500/20 border-red-500/50',
      text: 'text-red-300 font-bold',
      isOverdue: true,
    };
  } else if (diffDays === 0) {
    return {
      label: 'Heute fällig!',
      bg: 'bg-amber-500/20 border-amber-500/50 animate-pulse',
      text: 'text-amber-300 font-bold',
      isOverdue: false,
    };
  } else if (diffDays === 1) {
    return {
      label: 'Morgen',
      bg: 'bg-amber-500/15 border-amber-500/30',
      text: 'text-amber-300 font-medium',
      isOverdue: false,
    };
  } else if (diffDays <= 7) {
    return {
      label: `In ${diffDays} Tagen`,
      bg: 'bg-blue-500/15 border-blue-500/30',
      text: 'text-blue-300 font-medium',
      isOverdue: false,
    };
  } else {
    return {
      label: due.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }),
      bg: 'bg-neutral-800 border-neutral-700',
      text: 'text-neutral-300',
      isOverdue: false,
    };
  }
}

export function ReminderCard({ card, onUpdate, onDelete }: ReminderCardProps) {
  const [title, setTitle] = useState(card.title || 'Wichtiger Termin / Frist');
  const [content, setContent] = useState(card.content || '');
  const [dueDate, setDueDate] = useState(card.dueDate || '');
  const [isDone, setIsDone] = useState(card.tags?.includes('done') || false);

  const saveChanges = async (newTitle: string, newContent: string, newDueDate: string, newDone: boolean, newPinned?: boolean) => {
    const updatedTags = newDone ? ['done'] : [];
    const updated: DashboardCardRecord = {
      ...card,
      title: newTitle,
      content: newContent,
      dueDate: newDueDate,
      tags: updatedTags,
      isPinned: newPinned !== undefined ? newPinned : card.isPinned,
      updatedAt: new Date(),
      syncUpdatedAt: Date.now(),
    };
    await db.dashboardCards.put(updated);
    onUpdate(updated);
  };

  const handleTitleBlur = () => {
    if (title !== (card.title || '')) {
      saveChanges(title, content, dueDate, isDone);
    }
  };

  const handleContentBlur = () => {
    if (content !== (card.content || '')) {
      saveChanges(title, content, dueDate, isDone);
    }
  };

  const handleDueDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDueDate(val);
    saveChanges(title, content, val, isDone);
  };

  const handleToggleDone = () => {
    const nextDone = !isDone;
    setIsDone(nextDone);
    saveChanges(title, content, dueDate, nextDone);
  };

  const handleTogglePin = () => {
    saveChanges(title, content, dueDate, isDone, !card.isPinned);
  };

  const badge = formatDueDateBadge(dueDate);

  return (
    <div
      className={`relative group rounded-xl p-4 border transition-all duration-200 shadow-md backdrop-blur-sm flex flex-col justify-between ${
        isDone
          ? 'bg-neutral-900/40 border-neutral-800/60 opacity-60'
          : badge.isOverdue
          ? 'bg-red-950/20 border-red-800/50 hover:border-red-700'
          : 'bg-neutral-900/90 border-neutral-800 hover:border-neutral-700'
      } ${card.isPinned ? 'ring-1 ring-amber-500/50 shadow-amber-950/30' : ''}`}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              onClick={handleToggleDone}
              className={`p-1.5 rounded-lg border transition-colors shrink-0 ${
                isDone
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20'
              }`}
              title={isDone ? 'Als unerledigt markieren' : 'Als erledigt markieren'}
            >
              {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Calendar className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Termin / Erinnerung..."
              className={`bg-transparent font-semibold text-sm w-full focus:outline-none placeholder-neutral-500 border-b border-transparent focus:border-neutral-700 pb-0.5 ${
                isDone ? 'line-through text-neutral-400' : 'text-neutral-100'
              }`}
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
              title={card.isPinned ? 'Termin loslösen' : 'Oben anpinnen'}
            >
              <Pin className={`w-3.5 h-3.5 ${card.isPinned ? 'rotate-45 fill-amber-400' : ''}`} />
            </button>

            <button
              onClick={() => onDelete(card.id)}
              className="p-1 rounded-md text-neutral-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-950/50 transition-all"
              title="Termin löschen"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Date Picker & Due Badge */}
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-950 border border-neutral-800/80 mb-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <input
              type="date"
              value={dueDate}
              onChange={handleDueDateChange}
              className="bg-transparent text-xs text-neutral-200 focus:outline-none [color-scheme:dark] w-full"
            />
          </div>

          {dueDate && (
            <span
              className={`px-2 py-0.5 rounded-full border text-[10px] whitespace-nowrap ${badge.bg} ${badge.text}`}
            >
              {isDone ? 'Erledigt' : badge.label}
            </span>
          )}
        </div>

        {/* Content / Notes textarea */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onBlur={handleContentBlur}
          placeholder="Details, Ort, Link oder Notizen zum Termin..."
          rows={2}
          className="w-full bg-transparent text-xs leading-relaxed text-neutral-300 focus:outline-none resize-y placeholder-neutral-600"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-neutral-500 pt-2 border-t border-white/5 mt-2">
        <span className="flex items-center gap-1">
          {badge.isOverdue && !isDone && <AlertCircle className="w-3 h-3 text-red-400" />}
          <span>Erinnerung & Termin</span>
        </span>
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
