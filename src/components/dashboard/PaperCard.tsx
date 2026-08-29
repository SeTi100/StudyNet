import React from 'react';
import { DocumentRecord } from '../../db/schema';
import { FileText, MessageSquare, Edit3 } from 'lucide-react';

interface PaperCardProps {
  document: DocumentRecord;
  annotationCount: number;
  noteCount: number;
  onClick: () => void;
}

export function PaperCard({ document, annotationCount, noteCount, onClick }: PaperCardProps) {
  const isNew = !document.lastReadAt && document.lastReadPage === 1;
  const progressPercent = Math.min(100, Math.round((document.lastReadPage / document.totalPages) * 100)) || 0;
  
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
        {isNew && (
          <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold tracking-wider shrink-0">
            NEW
          </span>
        )}
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
          <span className="text-[10px] font-medium">{progressPercent}%</span>
        </div>
        
        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-neutral-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 transition-all duration-300" 
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
