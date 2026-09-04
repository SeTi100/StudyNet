import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Download, Copy, Check, X, Sparkles, Loader2, Edit3, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { extractFormulaFromBlob } from '../../services/formulaOcrService';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface SnipActionPopoverProps {
  previewUrl: string;
  blob: Blob;
  pageNumber: number;
  documentTitle: string;
  onInsertToNotes: (markdownSnippet?: string) => void;
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
  
  // OCR State
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedLatex, setExtractedLatex] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  
  const { geminiApiKey } = useSettingsStore();
  const katexRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (extractedLatex && katexRef.current) {
      try {
        katex.render(extractedLatex, katexRef.current, {
          displayMode: true,
          throwOnError: false,
        });
      } catch (e) {
        console.error("KaTeX render error", e);
      }
    }
  }, [extractedLatex]);

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

  const handleCopyLatex = async () => {
    if (!extractedLatex) return;
    try {
      await navigator.clipboard.writeText(extractedLatex);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Failed to copy latex to clipboard:', err);
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

  const handleExtractFormula = async () => {
    setIsExtracting(true);
    setExtractionError(null);
    try {
      const latex = await extractFormulaFromBlob(blob, geminiApiKey);
      setExtractedLatex(latex);
      setCopied(false);
    } catch (err: any) {
      setExtractionError(err.message || 'Ein Fehler ist aufgetreten.');
    } finally {
      setIsExtracting(false);
    }
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
            {extractedLatex ? 'Extrahierte Formel' : `Snip von Seite ${pageNumber}`}
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

      {/* Preview Area */}
      {extractedLatex !== null ? (
        <div className="flex flex-col bg-neutral-950/50">
          <div 
            className="p-4 bg-white/5 border-b border-neutral-800/80 min-h-[100px] flex items-center justify-center overflow-x-auto text-lg text-white font-serif"
            ref={katexRef}
          />
          <div className="p-3 bg-neutral-950 relative">
            <label className="text-[10px] uppercase text-neutral-500 font-semibold mb-1 block">LaTeX Code (Editierbar)</label>
            <textarea
              className="w-full bg-neutral-900 text-blue-300 font-mono text-xs p-2 rounded border border-neutral-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-h-[60px] resize-y"
              value={extractedLatex}
              onChange={(e) => setExtractedLatex(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>
      ) : (
        <div className="p-3 bg-neutral-950/50 flex flex-col items-center justify-center border-b border-neutral-800/80 max-h-56 overflow-hidden relative">
          <img
            src={previewUrl}
            alt={`Snip Seite ${pageNumber}`}
            className={`max-h-48 max-w-full object-contain rounded-lg border border-neutral-700/80 shadow-md bg-neutral-900 transition-opacity ${isExtracting ? 'opacity-30' : 'opacity-100'}`}
          />
          {isExtracting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
              <span className="text-sm font-semibold text-amber-400 animate-pulse drop-shadow-md">Analysiere Formel...</span>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {extractionError && (
        <div className="px-3.5 py-2.5 bg-red-950/80 border-b border-red-900 flex items-start gap-2 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
          <p>{extractionError}</p>
        </div>
      )}

      {/* Clipboard Status Banner (Only for image mode) */}
      {!extractedLatex && !extractionError && !isExtracting && (
        <div className="px-3.5 py-2 bg-emerald-950/40 border-b border-emerald-800/30 flex items-center justify-between text-xs text-emerald-300">
          <div className="flex items-center gap-1.5 font-medium">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>In Zwischenablage kopiert!</span>
          </div>
          <span className="text-[10px] text-emerald-400/80 bg-emerald-900/40 px-1.5 py-0.5 rounded border border-emerald-700/40">
            Strg + V bereit
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="p-3 flex flex-col gap-2 bg-neutral-900">
        
        {extractedLatex ? (
          <>
            <button
              onClick={() => onInsertToNotes(`$$ ${extractedLatex} $$`)}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow flex items-center justify-center gap-2 transition-all hover:scale-[1.01]"
            >
              <BookOpen className="w-4 h-4" />
              <span>Formel in Notes einfügen</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExtractedLatex(null)}
                className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                Zurück zum Bild
              </button>
              <button
                onClick={handleCopyLatex}
                className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-neutral-400" />
                    <span>LaTeX kopieren</span>
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => onInsertToNotes()}
              disabled={isExtracting}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100"
            >
              <BookOpen className="w-4 h-4" />
              <span>Bild in Study Notes einfügen</span>
            </button>

            <button
              onClick={handleExtractFormula}
              disabled={isExtracting}
              className="w-full py-2 px-3 bg-amber-600/90 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:hover:scale-100 border border-amber-500/50"
            >
              <Sparkles className="w-4 h-4" />
              <span>✨ Formel extrahieren (OCR)</span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleDownload}
                disabled={isExtracting}
                className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-neutral-400" />
                <span>PNG Download</span>
              </button>

              <button
                onClick={handleCopyAgain}
                disabled={isExtracting}
                className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 hover:text-white text-neutral-300 text-xs font-medium rounded-lg border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-neutral-400" />
                    <span>Bild kopieren</span>
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
