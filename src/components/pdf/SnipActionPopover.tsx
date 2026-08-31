import React, { useState } from 'react';
import { BookOpen, Download, Copy, Check, X, Sparkles } from 'lucide-react';

interface SnipActionPopoverProps {
  previewUrl: string;
  blob: Blob;
  pageNumber: number;
  documentTitle: string;
  onInsertToNotes: () => void;
  onClose: () => void;
}

export const SnipActionPopover: React.FC<SnipActionPopoverProps> = ({
  previewUrl,
  blob,
  pageNumber,
  documentTitle,
  onInsertToNotes,
  onClose,
}) => {
  const [copied, setCopied] = useState(true); // already copied automatically on creation

  const handleCopyAgain = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleDownload = () => {
    const safeTitle = (documentTitle || 'Paper')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 30);
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = `${safeTitle}_snip_page${pageNumber}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="absolute top-14 right-4 md:right-28 z-50 w-80 sm:w-96 bg-neutral-900/95 backdrop-blur-md border border-neutral-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 text-neutral-100 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-neutral-950/80 border-b border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-semibold text-neutral-200">
            Snip von Seite {pageNumber}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
          title="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Image Preview */}
      <div className="p-3 bg-neutral-950/50 flex flex-col items-center justify-center border-b border-neutral-800/80 max-h-56 overflow-hidden">
        <img
          src={previewUrl}
          alt={`Snip Seite ${pageNumber}`}
          className="max-h-48 max-w-full object-contain rounded-lg border border-neutral-700/80 shadow-md bg-neutral-900"
        />
      </div>

      {/* Clipboard Status Banner */}
      <div className="px-3.5 py-2 bg-emerald-950/40 border-b border-emerald-800/30 flex items-center justify-between text-xs text-emerald-300">
        <div className="flex items-center gap-1.5 font-medium">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>In Zwischenablage kopiert!</span>
        </div>
        <span className="text-[10px] text-emerald-400/80 bg-emerald-900/40 px-1.5 py-0.5 rounded border border-emerald-700/40">
          Strg + V bereit
        </span>
      </div>

      {/* Actions */}
      <div className="p-3 flex flex-col gap-2 bg-neutral-900">
        {/* Primary Action: Insert into Notes */}
        <button
          onClick={onInsertToNotes}
          className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
        >
          <BookOpen className="w-4 h-4" />
          <span>In Study Notes einfügen</span>
        </button>

        {/* Secondary Actions */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleDownload}
            className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors"
            title="Als PNG-Datei auf den PC herunterladen"
          >
            <Download className="w-3.5 h-3.5 text-neutral-400" />
            <span>PNG Download</span>
          </button>

          <button
            onClick={handleCopyAgain}
            className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors"
            title="Erneut in die Zwischenablage kopieren"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Kopiert!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
                <span>Kopieren</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
