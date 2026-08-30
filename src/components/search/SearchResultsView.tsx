import React, { useState } from 'react';
import { useSemanticSearchStore } from '../../store/useSemanticSearchStore';
import { useViewerStore } from '../../store/useViewerStore';
import {
  FileText,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  BarChart3,
  Beaker,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Tag,
} from 'lucide-react';
import type { QuestionCategory } from '../../db/schema';
import type { PaperSearchResult, MatchedQuestion } from '../../services/hybridSearchEngine';

/** Icons und Labels für Frage-Kategorien */
const CATEGORY_CONFIG: Record<
  QuestionCategory,
  { label: string; icon: React.ReactNode; color: string }
> = {
  method: {
    label: 'Methodik',
    icon: <FlaskConical className="w-3 h-3" />,
    color: 'bg-purple-900/40 text-purple-300 border-purple-800/50',
  },
  result: {
    label: 'Ergebnis',
    icon: <BarChart3 className="w-3 h-3" />,
    color: 'bg-blue-900/40 text-blue-300 border-blue-800/50',
  },
  material: {
    label: 'Material',
    icon: <Beaker className="w-3 h-3" />,
    color: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  },
  conclusion: {
    label: 'Schlussfolgerung',
    icon: <CheckCircle2 className="w-3 h-3" />,
    color: 'bg-green-900/40 text-green-300 border-green-800/50',
  },
  limitation: {
    label: 'Limitierung',
    icon: <AlertTriangle className="w-3 h-3" />,
    color: 'bg-red-900/40 text-red-300 border-red-800/50',
  },
  general: {
    label: 'Allgemein',
    icon: <HelpCircle className="w-3 h-3" />,
    color: 'bg-neutral-800/60 text-neutral-300 border-neutral-700/50',
  },
};

/**
 * Relevanz-Badge Komponente.
 * Zeigt den normalisierten Score als semantische Kategorie an.
 * Hover-Tooltip zeigt den exakten mathematischen Score.
 */
const RelevanceBadge: React.FC<{ badge: 'high' | 'related'; score: number }> = ({
  badge,
  score,
}) => {
  const config =
    badge === 'high'
      ? {
          label: 'Direkter Treffer',
          emoji: '🟢',
          className: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50',
        }
      : {
          label: 'Themenverwandt',
          emoji: '🟡',
          className: 'bg-yellow-950/50 text-yellow-300 border-yellow-800/50',
        };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${config.className} cursor-default`}
      title={`Kombinierter RRF-Score: ${score.toFixed(4)}`}
    >
      <span>{config.emoji}</span>
      {config.label}
    </span>
  );
};

/** Kategorie-Chip für einzelne Fragen */
const CategoryChip: React.FC<{ category: QuestionCategory }> = ({ category }) => {
  const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG.general;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${config.color}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
};

/** Einzelne gematchte Frage mit Context-Expansion Accordion */
const MatchedQuestionItem: React.FC<{
  match: MatchedQuestion;
  documentId: string;
}> = ({ match, documentId }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { question } = match;

  const handleOpenInPdf = () => {
    const textToHighlight = question.chunkText || question.shortAnswer || question.question;
    useViewerStore.getState().setPassageHighlight({
      text: textToHighlight,
      pageNumber: question.pageNumber,
    });
    const snippet = encodeURIComponent(textToHighlight);
    window.location.hash = `#doc=${documentId}&page=${question.pageNumber}&highlight=${snippet}&from=search`;
  };

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      {/* Frage-Header */}
      <div className="p-3 bg-neutral-900/50">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 mt-0.5 shrink-0">🎯</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-neutral-100 leading-relaxed">{question.question}</p>

            {/* Kurz-Antwort (Snippet) */}
            {question.shortAnswer && (
              <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                → {question.shortAnswer}
              </p>
            )}

            {/* Chips: Kategorie + Seite */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <CategoryChip category={question.category} />
              <span className="text-[10px] text-neutral-500">Seite {question.pageNumber}</span>
              <span
                className="text-[10px] text-neutral-600"
                title={`Vektor-Ähnlichkeit: ${(match.vectorScore * 100).toFixed(1)}%`}
              >
                ({(match.vectorScore * 100).toFixed(0)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Accordion-Toggle & PDF-Link */}
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-neutral-800">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Quelltext anzeigen
          </button>
          <button
            onClick={handleOpenInPdf}
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-400 transition-colors ml-auto"
          >
            <ExternalLink className="w-3 h-3" />
            Im PDF öffnen (S. {question.pageNumber})
          </button>
        </div>
      </div>

      {/* Context Expansion – Accordion Content */}
      {isExpanded && question.chunkText && (
        <div className="px-3 py-2 bg-neutral-950 border-t border-neutral-800">
          <p className="text-[11px] text-neutral-400 leading-relaxed whitespace-pre-line font-mono">
            {question.chunkText}
          </p>
        </div>
      )}
    </div>
  );
};

/** Einzelnes Paper-Ergebnis mit gematchten Fragen */
const PaperResultCard: React.FC<{ result: PaperSearchResult }> = ({ result }) => {
  const { document, matchedQuestions, relevanceBadge, paperScore } = result;

  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden">
      {/* Paper-Header */}
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 p-1.5 rounded-lg bg-blue-950/50 border border-blue-900/40 text-blue-400 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-neutral-100 leading-snug line-clamp-2">
              {document.title}
            </h3>
            {document.authors && document.authors.length > 0 && (
              <p className="text-xs text-neutral-500 mt-1">
                {document.authors.slice(0, 3).join(', ')}
                {document.authors.length > 3 ? ' et al.' : ''}
                {document.publicationYear ? ` (${document.publicationYear})` : ''}
              </p>
            )}
          </div>
        </div>
        <RelevanceBadge badge={relevanceBadge} score={paperScore} />
      </div>

      {/* Gematchte Fragen */}
      <div className="px-4 pb-4 space-y-2">
        {matchedQuestions.map((mq, idx) => (
          <MatchedQuestionItem
            key={mq.question.id || idx}
            match={mq}
            documentId={result.documentId}
          />
        ))}
      </div>
    </div>
  );
};

/** Kategorie-Filter Chips */
const CategoryFilterBar: React.FC = () => {
  const { categoryFilter, setCategoryFilter } = useSemanticSearchStore();
  const categories: QuestionCategory[] = [
    'method',
    'result',
    'material',
    'conclusion',
    'limitation',
  ];

  const toggleCategory = (cat: QuestionCategory) => {
    if (categoryFilter.includes(cat)) {
      setCategoryFilter(categoryFilter.filter((c) => c !== cat));
    } else {
      setCategoryFilter([...categoryFilter, cat]);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Tag className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
      {categories.map((cat) => {
        const config = CATEGORY_CONFIG[cat];
        const isActive = categoryFilter.includes(cat);
        return (
          <button
            key={cat}
            onClick={() => toggleCategory(cat)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg border transition-colors ${
              isActive
                ? config.color
                : 'bg-neutral-900/50 text-neutral-500 border-neutral-800 hover:border-neutral-700'
            }`}
          >
            {config.icon}
            {config.label}
          </button>
        );
      })}
      {categoryFilter.length > 0 && (
        <button
          onClick={() => setCategoryFilter([])}
          className="text-[10px] text-neutral-500 hover:text-neutral-300 ml-1"
        >
          Alle
        </button>
      )}
    </div>
  );
};

/**
 * Haupt-Ergebnisansicht für die semantische Suche.
 * Zeigt Paper-Karten mit gematchten Fragen, Relevanz-Badges,
 * Kategorie-Chips, Context-Expansion und Deep-Links.
 */
export const SearchResultsView: React.FC = () => {
  const { query, results, isSearching } = useSemanticSearchStore();

  // Nur anzeigen wenn eine Suche aktiv ist
  if (!query.trim()) return null;

  return (
    <div className="space-y-4">
      {/* Header mit Ergebnis-Count und Kategorie-Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-neutral-500">
          {isSearching ? (
            'Suche läuft...'
          ) : (
            <>
              <span className="font-semibold text-neutral-300">{results.length}</span>{' '}
              {results.length === 1 ? 'Paper' : 'Paper'} gefunden für &quot;
              <span className="text-neutral-300">{query}</span>&quot;
            </>
          )}
        </div>
        <CategoryFilterBar />
      </div>

      {/* Ergebnisliste */}
      {!isSearching && results.length === 0 && query.trim() && (
        <div className="text-center py-8 bg-neutral-900/30 rounded-xl border border-neutral-800 border-dashed">
          <p className="text-neutral-500 text-sm">Keine passenden Paper gefunden.</p>
          <p className="text-xs text-neutral-600 mt-1">
            Versuche andere Suchbegriffe oder analysiere weitere Paper.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {results.map((result) => (
          <PaperResultCard key={result.documentId} result={result} />
        ))}
      </div>
    </div>
  );
};
