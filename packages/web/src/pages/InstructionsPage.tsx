import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { getKnowledgeInstructionPath } from '../knowledgeSelection';
import type { MemoryAgentsItem } from '../types';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';

const INSTRUCTION_SEARCH_PARAM = 'instruction';
const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function matchesInstruction(item: MemoryAgentsItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    item.source,
    item.path,
    item.content,
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function sortInstructions(items: MemoryAgentsItem[]): MemoryAgentsItem[] {
  return [...items].sort((left, right) => left.source.localeCompare(right.source) || left.path.localeCompare(right.path));
}

function buildInstructionsSearch(locationSearch: string, instructionPath: string | null): string {
  const params = new URLSearchParams(locationSearch);

  if (instructionPath) {
    params.set(INSTRUCTION_SEARCH_PARAM, instructionPath);
  } else {
    params.delete(INSTRUCTION_SEARCH_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function InstructionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    data,
    loading,
    refreshing,
    error,
    refetch,
  } = useApi(api.memory);
  const [query, setQuery] = useState('');

  const instructions = useMemo(
    () => sortInstructions((data?.agentsMd ?? []).filter((item) => item.exists)),
    [data?.agentsMd],
  );
  const filteredInstructions = useMemo(
    () => instructions.filter((item) => matchesInstruction(item, query)),
    [instructions, query],
  );
  const selectedInstructionPath = useMemo(() => getKnowledgeInstructionPath(location.search), [location.search]);
  const selectedInstruction = useMemo(
    () => instructions.find((item) => item.path === selectedInstructionPath) ?? null,
    [instructions, selectedInstructionPath],
  );

  const setSelectedInstruction = useCallback((instructionPath: string | null, replace = false) => {
    const nextSearch = buildInstructionsSearch(location.search, instructionPath);
    navigate(`/instructions${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading || !selectedInstructionPath) {
      return;
    }

    if (instructions.some((item) => item.path === selectedInstructionPath)) {
      return;
    }

    setSelectedInstruction(null, true);
  }, [instructions, loading, selectedInstructionPath, setSelectedInstruction]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      >
        <PageHeading
          title="Instructions"
          meta={(
            <>
              {instructions.length} {instructions.length === 1 ? 'source' : 'sources'}
              {selectedInstruction && <span className="ml-2 text-secondary">· {selectedInstruction.source}</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading instructions…" />}
        {error && <ErrorState message={`Unable to load instructions: ${error}`} />}

        {!loading && !error && instructions.length === 0 && (
          <EmptyState
            title="No instructions yet."
            body="Load an AGENTS.md or other instruction source into the active profile to define durable behavior."
          />
        )}

        {!loading && !error && instructions.length > 0 && (
          <div className="space-y-5 pb-5">
            <div className="space-y-2">
              <p className="ui-card-meta">Instructions define the durable role, operating policy, and behavioral boundaries for the active profile. Inspect the selected source in the right sidebar.</p>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search instruction sources and content"
                aria-label="Search instruction sources"
                className={INPUT_CLASS}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="ui-card-meta">
                {query.trim()
                  ? `Showing ${filteredInstructions.length} of ${instructions.length} instruction sources.`
                  : 'Search across instruction source names, paths, and loaded content.'}
              </p>
            </div>

            {filteredInstructions.length === 0 ? (
              <EmptyState
                title="No instruction sources match that search"
                body="Try a broader search across source names, paths, and instruction content."
              />
            ) : (
              <div className="space-y-px">
                {filteredInstructions.map((item) => (
                  <ListLinkRow
                    key={item.path}
                    to={`/instructions${buildInstructionsSearch(location.search, item.path)}`}
                    selected={item.path === selectedInstructionPath}
                    leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
                  >
                    <p className="ui-row-title">{item.source}</p>
                    <p className="ui-row-summary">{item.path}</p>
                    <p className="ui-row-meta break-words">{item.content ? `${item.content.length.toLocaleString()} chars` : 'No content loaded'}</p>
                  </ListLinkRow>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
