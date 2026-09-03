import React, { useState, useEffect } from 'react';
import { db } from '../../db/schema';
import { useViewerStore } from '../../store/useViewerStore';
import { Palette, MessageSquare, X, Check, BookMarked } from 'lucide-react';
import { HIGHLIGHT_COLORS } from './AnnotationOverlayLayer';
import { downloadRisFile } from '../../services/risExportService';

interface AnnotationToolbarProps {
  documentId: string;
}

export const AnnotationToolbar: React.FC<AnnotationToolbarProps> = ({ documentId }) => {
  const { pendingSelection, setPendingSelection, activeAnnotationId, highlightOpacity } = useViewerStore();
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (activeAnnotationId) {
      setPosition(null);
      setIsCommenting(false);
      setCommentText('');
      return;
    }

    if (pendingSelection) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPosition({
          top: rect.top - 50, // 50px above the selection
          left: rect.left + rect.width / 2, // centered horizontally
        });
      }
    } else {
      setPosition(null);
      setIsCommenting(false);
      setCommentText('');
    }
  }, [pendingSelection, activeAnnotationId]);

  if (activeAnnotationId || !pendingSelection || !position) return null;

  const handleHighlight = async (color: string) => {
    try {
      await db.annotations.add({
        id: crypto.randomUUID(),
        documentId,
        pageNumber: pendingSelection.page,
        type: 'highlight',
        color,
        opacity: highlightOpacity,
        rects: pendingSelection.rects,
        selectedText: pendingSelection.text,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setPendingSelection(null);
    } catch (error) {
      console.error('Failed to save highlight:', error);
    }
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    try {
      await db.annotations.add({
        id: crypto.randomUUID(),
        documentId,
        pageNumber: pendingSelection.page,
        type: 'comment',
        color: '#FFEB3B', // default yellow for comments
        opacity: highlightOpacity,
        rects: pendingSelection.rects,
        selectedText: pendingSelection.text,
        comment: commentText.trim(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      setIsCommenting(false);
      setCommentText('');
      setPendingSelection(null);
    } catch (error) {
      console.error('Failed to save comment:', error);
    }
  };

  const handleExportCitaviRis = async () => {
    try {
      const doc = await db.documents.get(documentId);
      if (doc && pendingSelection) {
        downloadRisFile(doc, pendingSelection.text, pendingSelection.page);
        setPendingSelection(null);
      }
    } catch (error) {
      console.error('Failed to export Citavi RIS:', error);
    }
  };

  const handleCancel = () => {
    setPendingSelection(null);
    setIsCommenting(false);
    setCommentText('');
  };

  return (
    <div
      className="fixed z-[100] bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 rounded-lg p-2 flex items-center space-x-2 animate-in fade-in zoom-in duration-200"
      style={{
        top: `${Math.max(10, position.top)}px`,
        left: `${position.left}px`,
        transform: 'translateX(-50%)',
      }}
    >
      {!isCommenting ? (
        <>
          <div className="flex items-center space-x-1 border-r border-gray-200 dark:border-gray-700 pr-2">
            <Palette className="w-4 h-4 text-gray-500 mr-1" />
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => handleHighlight(c.value)}
                className="w-5 h-5 rounded-full border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-1 transition-transform hover:scale-115"
                style={{ backgroundColor: c.value }}
                title={`Markieren: ${c.label}`}
              />
            ))}
          </div>
          <button
            onClick={() => setIsCommenting(true)}
            className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
            title="Kommentar hinzufügen"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportCitaviRis}
            className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md transition-colors flex items-center gap-1 text-xs font-semibold"
            title="In Citavi importieren (.ris mit Zitat & Seitenzahl)"
          >
            <BookMarked className="w-4 h-4" />
            <span className="text-[10px] tracking-tight">.RIS</span>
          </button>
          <button
            onClick={handleCancel}
            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
            title="Abbrechen"
          >
            <X className="w-4 h-4" />
          </button>
        </>
      ) : (
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Type your comment..."
            className="text-sm px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleComment();
              if (e.key === 'Escape') setIsCommenting(false);
            }}
          />
          <button
            onClick={handleComment}
            disabled={!commentText.trim()}
            className="p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md transition-colors disabled:opacity-50"
            title="Save Comment"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsCommenting(false)}
            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
            title="Cancel Comment"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
