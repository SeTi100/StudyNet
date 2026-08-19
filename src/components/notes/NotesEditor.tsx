import React, { useState, useRef } from 'react';
import { NoteViewer } from './NoteViewer';
import { saveToOPFS } from '../../utils/opfsStorage';
import { Eye, Edit3, Image as ImageIcon, Sparkles, BookOpen } from 'lucide-react';

interface NotesEditorProps {
  documentId: string;
  documentTitle: string;
  initialContent?: string;
  onSave?: (content: string) => void;
}

export const NotesEditor: React.FC<NotesEditorProps> = ({
  documentId,
  documentTitle,
  initialContent,
  onSave,
}) => {
  const [content, setContent] = useState<string>(() => {
    return (
      initialContent ||
      localStorage.getItem(`notes_${documentId}`) ||
      `# Notes for ${documentTitle}\n\nKey insights and summary points from this study.\n\n### Important Findings\n- Point 1\n- Point 2\n\n### Visual Snippets\n`
    );
  });

  const [mode, setMode] = useState<'split' | 'edit' | 'preview'>('split');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleContentChange = (val: string) => {
    setContent(val);
    localStorage.setItem(`notes_${documentId}`, val);
    if (onSave) onSave(val);
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
      handleContentChange(newContent);
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

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 text-xs bg-blue-600/80 hover:bg-blue-600 text-white rounded-md flex items-center gap-1.5 transition-colors shadow-sm"
            title="Attach image snippet to OPFS"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Add Snip</span>
          </button>
        </div>
      </div>

      {/* Editor / Preview Content Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {(mode === 'edit' || mode === 'split') && (
          <div className={`h-full ${mode === 'split' ? 'w-1/2 border-r border-neutral-800' : 'w-full'} p-4 flex flex-col`}>
            <textarea
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Write your markdown research notes here... Paste images or click 'Add Snip' to save into OPFS."
              className="w-full h-full bg-transparent text-neutral-200 text-xs font-mono resize-none focus:outline-none placeholder-neutral-600 leading-relaxed"
            />
          </div>
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div className={`h-full ${mode === 'split' ? 'w-1/2' : 'w-full'} p-4 overflow-y-auto bg-neutral-950/40`}>
            <NoteViewer content={content} />
          </div>
        )}
      </div>
    </div>
  );
};
