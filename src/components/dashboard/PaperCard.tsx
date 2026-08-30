import React from 'react';
import { DocumentRecord } from '../../db/schema';
import { useDocumentStore, calculateReadingProgress } from '../../store/useDocumentStore';
import { FileText, MessageSquare, Edit3, Brain, Loader2, CheckCircle2 } from 'lucide-react';

interface PaperCardProps {
  document: DocumentRecord;
  annotationCount: number;
  noteCount: number;
  onClick: () => void;
  analysisStatus?: 'none' | 'analyzing' | 'done';
  questionCount?: number;
  onAnalyze?: (documentId: string) => void;
}

export function PaperCard({
  document,
  annotationCount,
  noteCount,
  onClick,
  analysisStatus = 'none',
  questionCount = 0,
  onAnalyze,
}: PaperCardProps) {
  const progress = calculateReadingProgress(document);
  const isNew = !document.lastReadAt && (!document.readPages || document.readPages.length === 0) && !document.isCompleted;

  const handleAnalyzeClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Verhindert Navigation zum Reader
    onAnalyze?.(document.id);
  };

  const handleToggleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Verhindert Navigation zum Reader
    await useDocumentStore.getState().toggleCompleted(document.id);
  };

  return (
    <div 
      onClick={onClick}
      className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col gap-3 cursor-pointer hover:border-blue-500/50 hover:bg-neutral-800 transition-all group min-h-[44px] min-w-[44px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-blue-400 transition-colors">
            {document.title}
          </h3>
          <p className="text-xs text-neutral-500 truncate mt-1">
            {document.authors?.join(', ') || 'Unknown Author'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isNew && (
            <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold tracking-wider">
              NEW
            </span>
          )}
          {/* Analyse-Status Badge */}
          {analysisStatus === 'done' && (
            <span
              className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold flex items-center gap-1"
              title={`${questionCount} Fragen generiert`}
            >
              <Brain className="w-3 h-3" />
              {questionCount}
            </span>
          )}
          {analysisStatus === 'analyzing' && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-semibold flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analyse
            </span>
          )}
          {/* Gelesen-Status Checkmark Toggle */}
          <button
            onClick={handleToggleComplete}
            className={`p-1 rounded-md transition-all ${
              progress.isCompleted
                ? 'text-emerald-400 bg-emerald-500/20 hover:bg-emerald-500/30'
                : 'text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800'
            }`}
            title={
              progress.isCompleted
                ? 'Als gelesen markiert (Klick zum Zurücksetzen)'
                : `${progress.readPagesCount}/${progress.effectiveTotalPages} Seiten gelesen (${progress.percent}%)${progress.hasBibliography ? ' – ohne Quellenverzeichnis' : ''}. Klick zum Fertig-Markieren`
            }
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-auto pt-2 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1" title="Annotations">
              <Edit3 className="w-3.5 h-3.5" />
              {annotationCount}
            </span>
            <span className="flex items-center gap-1" title="Notes">
              <MessageSquare className="w-3.5 h-3.5" />
              {noteCount}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Analyse-Button (nur wenn noch nicht analysiert) */}
            {analysisStatus === 'none' && onAnalyze && (
              <button
                onClick={handleAnalyzeClick}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-900/30 text-purple-400 hover:bg-purple-900/50 text-[10px] font-medium transition-colors border border-purple-800/30"
                title="Paper mit KI analysieren"
              >
                <Brain className="w-3 h-3" />
                Analysieren
              </button>
            )}
            <span
              className={`text-[10px] font-medium font-mono ${
                progress.isCompleted ? 'text-emerald-400 font-semibold' : 'text-neutral-400'
              }`}
              title={`${progress.readPagesCount}/${progress.effectiveTotalPages} Seiten gelesen${progress.hasBibliography ? ' (ohne Quellenverzeichnis)' : ''}`}
            >
              {progress.percent}%
            </span>
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-300 ${
              progress.isCompleted ? 'bg-emerald-500' : 'bg-blue-500'
            }`} 
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

