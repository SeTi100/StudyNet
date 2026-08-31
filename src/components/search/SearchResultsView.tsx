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
  Sparkles,
  Search,
  Lightbulb,
  Brain,
  Edit3,
} from 'lucide-react';
import type { QuestionCategory } from '../../db/schema';
import type { PaperSearchResult, MatchedChunk } from '../../services/hybridSearchEngine';

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
 */
const RelevanceBadge: React.FC<{ badge: 'high' | 'related'; score: number }> = ({
  badge,
  score,
}) => {
  const config =
    badge === 'high'
      ? {
          label: 'Direkter Treffer',
          dotColor: 'bg-emerald-400',
          className: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/50',
        }
      : {
          label: 'Themenverwandt',
          dotColor: 'bg-amber-400',
          className: 'bg-yellow-950/50 text-yellow-300 border-yellow-800/50',
        };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${config.className} cursor-default`}
      title={`Kombinierter RRF-Score: ${score.toFixed(4)}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
};

/** Kategorie-Chip für Fragen */
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

/** Einzelner gematchter Chunk mit Context Expansion & Trigger-Fragen */
const MatchedChunkItem: React.FC<{
  match: MatchedChunk;
  documentId: string;
}> = ({ match, documentId }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleOpenInPdf = () => {
    // Vollständigen Rohtext des Parent-Chunks übergeben
    const textToHighlight = match.parentChunkText || match.triggerQuestion?.text || '';
    if (!textToHighlight) return;

    useViewerStore.getState().setPassageHighlight({
      text: textToHighlight,
      pageNumber: match.pageNumber,
    });
    const snippet = encodeURIComponent(textToHighlight.slice(0, 120));
    window.location.hash = `#doc=${documentId}&page=${match.pageNumber}&highlight=${snippet}&from=search`;
  };

  // Match-Typ ermitteln
  const isBoth = match.rankVector > 0 && match.rankKeyword > 0;
  const isVectorOnly = match.rankVector > 0 && match.rankKeyword === 0;

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden bg-neutral-900/50">
      <div className="p-3">
        {/* Rohtext des Parent-Chunks */}
        <div className="flex items-start gap-2">
          <FileText className="w-3.5 h-3.5 text-neutral-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p
              className={`text-xs text-neutral-200 leading-relaxed font-sans ${
                !isExpanded ? 'line-clamp-3' : ''
              }`}
            >
              {match.parentChunkText}
            </p>

            {/* Trigger-Frage Banner (falls Match über Frage ausgelöst wurde) */}
            {match.triggerQuestion && (
              <div className="flex items-start gap-2 text-xs bg-amber-950/30 border border-amber-900/40 rounded-md p-2 mt-2.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-amber-200/90 leading-tight">
                    <span className="font-medium text-amber-300">Gefunden über: </span>
                    &ldquo;{match.triggerQuestion.text}&rdquo;
                  </p>
                </div>
                {match.triggerQuestion.category && (
                  <CategoryChip category={match.triggerQuestion.category} />
                )}
              </div>
            )}

            {/* Meta-Chips: Seite, Score & Suchtyp */}
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              {/* Match-Typ Indikator */}
              {isBoth ? (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/40"
                  title="Treffer in Semantik & Volltext"
                >
                  <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                  Perfekter Match
                </span>
              ) : isVectorOnly ? (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-950/60 text-purple-300 border border-purple-800/40"
                  title="Semantischer Treffer (Vektorsuche)"
                >
                  <Brain className="w-2.5 h-2.5 text-purple-400" />
                  Semantisch
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-950/60 text-blue-300 border border-blue-800/40"
                  title="Volltext-Treffer (Keyword-Suche)"
                >
                  <Search className="w-2.5 h-2.5 text-blue-400" />
                  Keyword
                </span>
              )}

              <span className="text-[10px] text-neutral-400 font-medium">
                Seite {match.pageNumber}
              </span>

              {match.vectorScore > 0 && (
                <span
                  className="text-[10px] text-neutral-500 font-mono"
                  title={`Kosinus-Ähnlichkeit: ${(match.vectorScore * 100).toFixed(1)}%`}
                >
                  ({(match.vectorScore * 100).toFixed(0)}% Ähnlichkeit)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer: Aufklappen & PDF Deep Link */}
        <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-neutral-800/80">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="w-3 h-3" />
                Weniger anzeigen
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                Volltext anzeigen
              </>
            )}
          </button>
          <button
            onClick={handleOpenInPdf}
            className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium transition-colors ml-auto"
          >
            <ExternalLink className="w-3 h-3" />
            Im PDF öffnen (S. {match.pageNumber})
          </button>
        </div>
      </div>
    </div>
  );
};

/** Einzelnes Paper-Ergebnis mit gematchten Parent-Chunks */
const PaperResultCard: React.FC<{ result: PaperSearchResult }> = ({ result }) => {
  const { document, matchedChunks, relevanceBadge, paperScore } = result;

  return (
    <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl overflow-hidden shadow-sm">
      {/* Paper-Header */}
      <div className="p-4 flex items-start justify-between gap-3 border-b border-neutral-800/50">
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

      {/* Gematchte Chunks */}
      <div className="p-3 space-y-2.5">
        {matchedChunks.map((chunk, idx) => (
          <MatchedChunkItem
            key={chunk.chunkId || idx}
            match={chunk}
            documentId={result.documentId}
          />
        ))}
      </div>
    </div>
  );
};

/** Benutzer-Notizen & Annotationen Sektion (Top-Priorität) */
const UserContentSection: React.FC = () => {
  const { userMatches, showUserMatches, toggleShowUserMatches } = useSemanticSearchStore();

  if (!userMatches || userMatches.length === 0 || !showUserMatches) return null;

  return (
    <div className="bg-neutral-900/80 border border-purple-500/30 rounded-xl overflow-hidden shadow-md">
      <div className="p-3.5 bg-purple-950/30 border-b border-purple-500/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-purple-500/20 text-purple-300">
            <Edit3 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-purple-200 tracking-wide uppercase">
              Deine Notizen & Markierungen ({userMatches.length})
            </h3>
            <p className="text-[11px] text-purple-300/70">
              Direkte Treffer in deinen persönlichen Aufzeichnungen
            </p>
          </div>
        </div>
        <button
          onClick={toggleShowUserMatches}
          className="text-xs text-purple-400 hover:text-purple-200 font-medium px-2 py-1 rounded bg-purple-900/30 hover:bg-purple-900/50 border border-purple-700/40 transition-colors"
        >
          Ausblenden
        </button>
      </div>

      <div className="p-3 space-y-2.5">
        {userMatches.map((match) => (
          <div
            key={`${match.type}-${match.id}`}
            onClick={() => {
              const highlightParam = match.selectedText ? `&highlight=${encodeURIComponent(match.selectedText.slice(0, 100))}` : '';
              window.location.hash = `#doc=${match.documentId}&page=${match.pageNumber}${highlightParam}&from=search`;
            }}
            className="p-3 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-purple-500/50 hover:bg-neutral-800/80 cursor-pointer transition-all group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                    match.type === 'note'
                      ? 'bg-blue-950/60 text-blue-300 border-blue-800/50'
                      : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
                  }`}
                >
                  {match.type === 'note' ? 'Notiz' : 'Markierung'}
                </span>
                <span className="text-xs font-medium text-neutral-200 group-hover:text-purple-300 transition-colors truncate">
                  {match.title || match.comment || 'Textmarkierung'}
                </span>
              </div>
              <span className="text-[11px] text-purple-400 group-hover:translate-x-0.5 transition-transform shrink-0 flex items-center gap-1 font-medium">
                Seite {match.pageNumber}
                <ExternalLink className="w-3 h-3" />
              </span>
            </div>

            <p className="text-xs text-neutral-400 mt-2 leading-relaxed font-sans line-clamp-2">
              {match.snippet}
            </p>

            <div className="mt-2 pt-2 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-500">
              <span className="truncate max-w-[80%]" title={match.documentTitle}>
                Paper: {match.documentTitle}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Kategorie-Filter Chips */
const CategoryFilterBar: React.FC = () => {
  const { categoryFilter, setCategoryFilter, userMatches, showUserMatches, toggleShowUserMatches } = useSemanticSearchStore();
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
      {/* Toggle für Notizen & Markierungen */}
      {userMatches && userMatches.length > 0 && (
        <button
          onClick={toggleShowUserMatches}
          className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold rounded-lg border transition-colors ${
            showUserMatches
              ? 'bg-purple-950/80 text-purple-300 border-purple-700/60 ring-1 ring-purple-500/30'
              : 'bg-neutral-900/50 text-neutral-500 border-neutral-800 hover:border-neutral-700'
          }`}
          title="Persönliche Notizen ein-/ausblenden"
        >
          <Edit3 className="w-3 h-3 text-purple-400" />
          Notizen ({userMatches.length})
        </button>
      )}

      <Tag className="w-3.5 h-3.5 text-neutral-500 shrink-0 ml-1" />
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
 * Zeigt Paper-Karten mit gematchten Parent-Chunks, Relevanz-Badges,
 * Kategorie-Chips, Trigger-Fragen und Deep-Links.
 */
export const SearchResultsView: React.FC = () => {
  const { query, results, userMatches, isSearching } = useSemanticSearchStore();

  // Nur anzeigen wenn eine Suche aktiv ist
  if (!query.trim()) return null;

  const totalResultsCount = results.length + (userMatches?.length || 0);

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
              {results.length === 1 ? 'Paper' : 'Paper'}
              {userMatches && userMatches.length > 0 && (
                <> & <span className="font-semibold text-purple-300">{userMatches.length} Notizen</span></>
              )}{' '}
              gefunden für &quot;
              <span className="text-neutral-300">{query}</span>&quot;
            </>
          )}
        </div>
        <CategoryFilterBar />
      </div>

      {/* ── TOP-PRIORITÄT: Eigene Notizen & Annotationen ── */}
      {!isSearching && <UserContentSection />}

      {/* Ergebnisliste Paper */}
      {!isSearching && totalResultsCount === 0 && query.trim() && (
        <div className="text-center py-8 bg-neutral-900/30 rounded-xl border border-neutral-800 border-dashed">
          <p className="text-neutral-500 text-sm">Keine passenden Paper oder Notizen gefunden.</p>
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

