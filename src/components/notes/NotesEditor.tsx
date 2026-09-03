import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { NoteViewer } from './NoteViewer';
import { saveToOPFS } from '../../utils/opfsStorage';
import { db, NoteRecord } from '../../db/schema';
import { Eye, Edit3, Image as ImageIcon, Sparkles, BookOpen, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repairMislinkedNotes } from '../../services/noteRepairService';

interface NotesEditorProps {
  documentId: string;
  documentTitle?: string;
  initialContent?: string;
  onSave?: (content: string) => void;
  onClose?: () => void;
}

export const NotesEditor: React.FC<NotesEditorProps> = ({
  documentId,
  documentTitle,
  initialContent,
  onSave,
  onClose,
}) => {
  const [content, setContent] = useState<string>('');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef<number>(0);
  const localContentRef = useRef<string>('');
  const lastSavedContentRef = useRef<string>('');
  const currentNoteDocIdRef = useRef<string | null>(null);
  const pendingSavesRef = useRef<Set<string>>(new Set());
  const cursorPositionRef = useRef<{ start: number; end: number } | null>(null);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  // Preserve cursor position across content updates while the textarea is focused
  useLayoutEffect(() => {
    if (textareaRef.current && document.activeElement === textareaRef.current && cursorPositionRef.current) {
      const { start, end } = cursorPositionRef.current;
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(Math.min(start, len), Math.min(end, len));
    }
  }, [content]);

  // Preserve scroll position in the preview container across content updates
  useLayoutEffect(() => {
    if (previewContainerRef.current && lastScrollTopRef.current > 0) {
      previewContainerRef.current.scrollTop = lastScrollTopRef.current;
    }
  }, [content]);

  // Live Query from Dexie to catch external note additions (e.g. from Snip popover)
  const dbNote = useLiveQuery(
    async () => {
      const allNotes = await db.notes.where('documentId').equals(documentId).toArray();
      if (allNotes.length === 0) return undefined;
      allNotes.sort((a, b) => {
        const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tB - tA;
      });
      return allNotes.find(
        (n) => n.content && !n.content.includes('Key insights and summary points from this study')
      ) || allNotes[0];
    },
    [documentId]
  );

  // Initialize or load note (only once per document instance)
  useEffect(() => {
    if (isInitializedRef.current) return;

    async function initNote() {
      try {
        await repairMislinkedNotes();
      } catch (err) {
        console.warn('Auto-repair mislinked notes on initNote failed:', err);
      }

      const allNotes = await db.notes.where('documentId').equals(documentId).toArray();
      let existing: NoteRecord | undefined;
      if (allNotes.length > 0) {
        allNotes.sort((a, b) => {
          const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
          const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
          return tB - tA;
        });
        existing = allNotes.find(
          (n) => n.content && !n.content.includes('Key insights and summary points from this study')
        ) || allNotes[0];
      }

      if (existing) {
        isInitializedRef.current = true;
        currentNoteDocIdRef.current = documentId;
        setNoteId(existing.id);
        setContent(existing.content);
        localContentRef.current = existing.content;
        lastSavedContentRef.current = existing.content;
      } else {
        const defaultContent = initialContent || `# Notes for ${documentTitle}\n\nKey insights and summary points from this study.\n\n### Important Findings\n- Point 1\n- Point 2\n\n### Visual Snippets\n`;
        const newNote: NoteRecord = {
          id: crypto.randomUUID(),
          documentId,
          title: `Notes for ${documentTitle}`,
          content: defaultContent,
          linkedAnnotationIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          syncUpdatedAt: Date.now(),
        };
        await db.notes.add(newNote);
        isInitializedRef.current = true;
        currentNoteDocIdRef.current = documentId;
        setNoteId(newNote.id);
        setContent(defaultContent);
        localContentRef.current = defaultContent;
        lastSavedContentRef.current = defaultContent;
      }
    }
    initNote();
  }, [documentId, initialContent]);

  // Sync state ONLY when dbNote changes from a genuine external action (e.g. Snip popover insert)
  useEffect(() => {
    if (!dbNote || dbNote.id !== noteId || dbNote.documentId !== documentId) return;

    // 1. If this is content we saved ourselves, consume it and ignore
    if (pendingSavesRef.current.has(dbNote.content)) {
      pendingSavesRef.current.delete(dbNote.content);
      return;
    }

    // 2. If it already matches what is in local state, nothing to do
    if (dbNote.content === localContentRef.current) {
      return;
    }

    // 3. If user is actively typing (textarea focused or debounce pending),
    // NEVER overwrite local active typing with stale Dexie snapshots!
    const isTextareaFocused = textareaRef.current && document.activeElement === textareaRef.current;
    if (isTextareaFocused || saveDebounceRef.current !== null) {
      return;
    }

    // 4. Truly external update while not typing: update local state safely
    localContentRef.current = dbNote.content;
    lastSavedContentRef.current = dbNote.content;
    setContent(dbNote.content);
  }, [dbNote, noteId, documentId]);

  const handleContentChange = useCallback((val: string) => {
    // 1. Synchronously capture cursor position before state update
    if (textareaRef.current) {
      cursorPositionRef.current = {
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd,
      };
    }

    // 2. Immediately update local state for zero-latency typing & stable cursor
    setContent(val);
    localContentRef.current = val;

    // 3. Debounce Dexie database save to prevent async race conditions with useLiveQuery
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
    }

    saveDebounceRef.current = setTimeout(async () => {
      saveDebounceRef.current = null;
      if (noteId && currentNoteDocIdRef.current === documentId) {
        try {
          pendingSavesRef.current.add(val);
          lastSavedContentRef.current = val;
          // Keep set bounded
          if (pendingSavesRef.current.size > 20) {
            const first = pendingSavesRef.current.values().next().value;
            if (first) pendingSavesRef.current.delete(first);
          }

          await db.notes.update(noteId, {
            content: val,
            updatedAt: new Date(),
            syncUpdatedAt: Date.now(),
          });
        } catch (err) {
          console.warn('Failed to save note:', err);
        }
      }
      if (onSave) onSave(val);
    }, 400);
  }, [noteId, documentId, onSave]);

  // Flush any pending debounced save on unmount so nothing is ever lost
  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
      }
      if (
        noteId &&
        currentNoteDocIdRef.current === documentId &&
        localContentRef.current &&
        localContentRef.current !== lastSavedContentRef.current
      ) {
        db.notes.update(noteId, {
          content: localContentRef.current,
          updatedAt: new Date(),
          syncUpdatedAt: Date.now(),
        }).catch((err) => console.warn('Flush note on unmount failed:', err));
      }
    };
  }, [noteId, documentId]);

  // Image manipulation handlers
  const handleUpdateImageParams = useCallback(async (
    oldSrc: string,
    newParams: { width?: number; rotate?: number; align?: 'left' | 'center' | 'right' }
  ) => {
    let baseUrl = oldSrc;
    const hashIdx = oldSrc.indexOf('#');
    const qIdx = oldSrc.indexOf('?');
    if (hashIdx !== -1) baseUrl = oldSrc.substring(0, hashIdx);
    else if (qIdx !== -1) baseUrl = oldSrc.substring(0, qIdx);

    const paramParts: string[] = [];
    if (newParams.width) paramParts.push(`w=${newParams.width}`);
    if (newParams.rotate && newParams.rotate !== 0) paramParts.push(`r=${newParams.rotate}`);
    if (newParams.align && newParams.align !== 'center') paramParts.push(`align=${newParams.align}`);

    const newSrc = paramParts.length > 0 ? `${baseUrl}#${paramParts.join('&')}` : baseUrl;

    setContent((prev) => {
      const updated = prev.replace(oldSrc, newSrc);
      localContentRef.current = updated;
      lastSavedContentRef.current = updated;
      pendingSavesRef.current.add(updated);
      if (noteId && currentNoteDocIdRef.current === documentId) {
        db.notes.update(noteId, { content: updated, updatedAt: new Date(), syncUpdatedAt: Date.now() });
      }
      return updated;
    });
  }, [noteId, documentId]);

  const handleDeleteImage = useCallback(async (src: string) => {
    setContent((prev) => {
      const lines = prev.split('\n');
      const filteredLines: string[] = [];
      let skipNextCaption = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(src)) {
          if (i + 1 < lines.length && lines[i + 1].trim().startsWith('*') && lines[i + 1].trim().endsWith('*')) {
            skipNextCaption = true;
          }
          continue;
        }
        if (skipNextCaption) {
          skipNextCaption = false;
          continue;
        }
        filteredLines.push(line);
      }

      const updated = filteredLines.join('\n');
      localContentRef.current = updated;
      lastSavedContentRef.current = updated;
      pendingSavesRef.current.add(updated);
      if (noteId && currentNoteDocIdRef.current === documentId) {
        db.notes.update(noteId, { content: updated, updatedAt: new Date(), syncUpdatedAt: Date.now() });
      }
      return updated;
    });
  }, [noteId, documentId]);

  const handleMoveImageBlock = useCallback(async (src: string, direction: 'up' | 'down') => {
    setContent((prev) => {
      const blocks = prev.split(/\n\s*\n/);
      const targetIndex = blocks.findIndex((b) => b.includes(src));
      if (targetIndex === -1) return prev;

      const newIndex = direction === 'up' ? targetIndex - 1 : targetIndex + 1;
      if (newIndex < 0 || newIndex >= blocks.length) return prev;

      const newBlocks = [...blocks];
      const [moved] = newBlocks.splice(targetIndex, 1);
      newBlocks.splice(newIndex, 0, moved);

      const updated = newBlocks.join('\n\n');
      localContentRef.current = updated;
      lastSavedContentRef.current = updated;
      pendingSavesRef.current.add(updated);
      if (noteId && currentNoteDocIdRef.current === documentId) {
        db.notes.update(noteId, { content: updated, updatedAt: new Date(), syncUpdatedAt: Date.now() });
      }
      return updated;
    });
  }, [noteId, documentId]);

  // Direct paste support (Ctrl+V with image on clipboard)
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        try {
          const fileName = `${documentId}_pasted_${Date.now()}.png`;
          const opfsPath = await saveToOPFS(file, 'snips', fileName);
          const markdownImage = `\n\n![Pasted Snippet](${opfsPath})\n*Figure snippet*\n\n`;

          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const updated = content.substring(0, start) + markdownImage + content.substring(end);
            await handleContentChange(updated);
          } else {
            await handleContentChange(content + markdownImage);
          }
        } catch (err) {
          console.error('Failed to save pasted image to OPFS:', err);
        }
        break;
      }
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const fileName = `${documentId}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const opfsPath = await saveToOPFS(file, 'snips', fileName);

      // Insert markdown image with opfs:// prefix
      const markdownImage = `\n\n![${file.name}](${opfsPath})\n*Figure snippet from study*\n\n`;
      const newContent = content + markdownImage;
      await handleContentChange(newContent);
    } catch (err) {
      console.error('Failed to save snip to OPFS:', err);
      alert('Could not save image snippet to OPFS storage.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-neutral-900 border-l border-neutral-800">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-neutral-200">Study Notes & Snips</span>
        </div>

        <div className="flex items-center gap-1 bg-neutral-800 p-0.5 rounded-lg border border-neutral-700">
          <button
            onClick={() => setMode('edit')}
            className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
              mode === 'edit' ? 'bg-neutral-700 text-white font-medium shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Editor view"
          >
            <Edit3 className="w-3 h-3" />
            <span>Write</span>
          </button>
          <button
            onClick={() => setMode('split')}
            className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
              mode === 'split' ? 'bg-neutral-700 text-white font-medium shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Split editor & preview"
          >
            <Sparkles className="w-3 h-3" />
            <span>Split</span>
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`px-2 py-1 text-[11px] rounded flex items-center gap-1 transition-colors ${
              mode === 'preview' ? 'bg-neutral-700 text-white font-medium shadow-sm' : 'text-neutral-400 hover:text-neutral-200'
            }`}
            title="Rendered preview"
          >
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 text-xs bg-blue-600/80 hover:bg-blue-600 text-white rounded-md flex items-center gap-1.5 transition-colors shadow-sm min-h-[36px] justify-center"
            title="Attach image snippet to OPFS"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Add Snip</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
              title="Notizen ausblenden (Vollbild PDF)"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Editor / Preview Content Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {(mode === 'edit' || mode === 'split') && (
          <div className={`h-full ${mode === 'split' ? 'w-1/2 border-r border-neutral-800' : 'w-full'} p-4 flex flex-col`}>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onSelect={(e) => {
                const target = e.currentTarget;
                cursorPositionRef.current = {
                  start: target.selectionStart,
                  end: target.selectionEnd,
                };
              }}
              onKeyUp={(e) => {
                const target = e.currentTarget;
                cursorPositionRef.current = {
                  start: target.selectionStart,
                  end: target.selectionEnd,
                };
              }}
              onClick={(e) => {
                const target = e.currentTarget;
                cursorPositionRef.current = {
                  start: target.selectionStart,
                  end: target.selectionEnd,
                };
              }}
              onPaste={handlePaste}
              placeholder="Schreibe Notizen im Markdown-Format... Bilder per Strg+V einfügen oder über 'Add Snip' hochladen."
              className="w-full h-full bg-transparent text-neutral-200 text-xs font-mono resize-none focus:outline-none placeholder-neutral-600 leading-relaxed min-h-[44px]"
            />
          </div>
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div
            ref={previewContainerRef}
            onScroll={(e) => {
              lastScrollTopRef.current = e.currentTarget.scrollTop;
            }}
            className={`h-full ${mode === 'split' ? 'w-1/2' : 'w-full'} p-4 overflow-y-auto bg-neutral-950/40`}
          >
            <NoteViewer
              content={content}
              onUpdateImage={handleUpdateImageParams}
              onDeleteImage={handleDeleteImage}
              onMoveImageBlock={handleMoveImageBlock}
              isEditable={true}
            />
          </div>
        )}
      </div>
    </div>
  );
};
