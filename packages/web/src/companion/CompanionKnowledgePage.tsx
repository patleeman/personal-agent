import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { BrowserRecordRow, cx } from '../components/ui';
import { useApi } from '../hooks';
import {
  buildNodesSearch,
  matchesNodeBrowserQuery,
  readNodeBrowserFilter,
  readNodeBrowserQuery,
  readSelectedNode,
  type NodeBrowserFilter,
} from '../nodeWorkspaceState';
import type { NodeBrowserSummary, NodeLinkKind } from '../types';
import { timeAgo } from '../utils';
import { CompanionSection } from './CompanionBrowser';
import {
  buildCompanionPagePath,
  COMPANION_PAGES_PATH,
} from './routes';
import { useCompanionTopBarAction } from './CompanionLayout';
import { CompanionMemoryDetailPage } from './CompanionMemoryDetailPage';
import { CompanionProjectDetailPage } from './CompanionProjectDetailPage';
import { CompanionSkillDetailPage } from './CompanionSkillDetailPage';

const INPUT_CLASS = 'w-full rounded-2xl border border-border-default bg-base px-3.5 py-3 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const SELECT_CLASS = `${INPUT_CLASS} pr-9`;
const QUERY_INPUT_CLASS = `${INPUT_CLASS} font-mono text-[13px]`;
const FILTER_OPTIONS: Array<{ value: NodeBrowserFilter; label: string }> = [
  { value: 'all', label: 'All docs' },
  { value: 'page', label: 'Docs' },
  { value: 'skill', label: 'Skills' },
];
const CORE_QUERY_FIELDS = [
  { key: 'type', detail: 'page or skill' },
  { key: 'status', detail: 'active, inbox, done, archived…' },
  { key: 'profile', detail: 'profile ownership tag' },
  { key: 'area', detail: 'domain or work area' },
  { key: 'parent', detail: 'parent page id' },
  { key: 'tag', detail: 'raw tag value' },
  { key: 'id', detail: 'page id' },
  { key: 'title', detail: 'title text' },
] as const;
const PAGE_KIND_ORDER: NodeLinkKind[] = ['project', 'note', 'skill'];

function kindLabel(kind: NodeLinkKind | 'page'): string {
  switch (kind) {
    case 'skill':
      return 'Skill';
    case 'project':
    case 'note':
    case 'page':
      return 'Doc';
  }
}

function pluralKindLabel(kind: NodeLinkKind | 'page'): string {
  switch (kind) {
    case 'skill':
      return 'Skills';
    case 'project':
    case 'note':
    case 'page':
      return 'Docs';
  }
}

function humanizeStatus(status: string): string {
  const normalized = status.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Unknown';
  }

  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readQueryToken(query: string, cursor: number) {
  const clampedCursor = Math.max(0, Math.min(cursor, query.length));
  const beforeCursor = query.slice(0, clampedCursor);
  const match = beforeCursor.match(/(^|[\s(])([^\s()]*)$/);
  const token = match?.[2] ?? '';
  return {
    start: clampedCursor - token.length,
    end: clampedCursor,
    token,
  };
}

function buildQueryFieldInsertion(query: string, cursor: number, fieldKey: string) {
  const snippet = `${fieldKey}:`;
  const { start, end, token } = readQueryToken(query, cursor);
  const normalizedToken = token.replace(/^[+-]/, '');
  const shouldReplaceToken = normalizedToken.length > 0 && !normalizedToken.includes(':');
  const insertStart = shouldReplaceToken ? start : end;
  const prefix = query.slice(0, insertStart);
  const suffix = query.slice(end);
  const separator = prefix.length > 0 && !/[\s(]$/.test(prefix) ? ' ' : '';
  const nextQuery = `${prefix}${separator}${snippet}${suffix}`;
  return {
    nextQuery,
    nextCursor: prefix.length + separator.length + snippet.length,
  };
}

function LuceneQueryInput({
  query,
  visibleCount,
  onQueryChange,
}: {
  query: string;
  visibleCount: number;
  onQueryChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!focused) {
      return [];
    }

    const { token } = readQueryToken(query, cursor ?? query.length);
    const normalizedToken = token.replace(/^[+-]/, '').toLowerCase();
    if (normalizedToken.includes(':')) {
      return [];
    }

    return CORE_QUERY_FIELDS.filter((field) => normalizedToken.length === 0 || field.key.startsWith(normalizedToken));
  }, [cursor, focused, query]);

  useEffect(() => {
    if (suggestions.length === 0) {
      setActiveSuggestionIndex(0);
      return;
    }

    setActiveSuggestionIndex((current) => Math.min(current, suggestions.length - 1));
  }, [suggestions]);

  const applyField = useCallback((fieldKey: string) => {
    const currentCursor = inputRef.current?.selectionStart ?? cursor ?? query.length;
    const insertion = buildQueryFieldInsertion(query, currentCursor, fieldKey);
    onQueryChange(insertion.nextQuery);
    setCursor(insertion.nextCursor);
    setActiveSuggestionIndex(0);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(insertion.nextCursor, insertion.nextCursor);
    });
  }, [cursor, onQueryChange, query]);

  const activeSuggestion = suggestions[activeSuggestionIndex] ?? null;

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">Lucene query</span>
        <div className="relative mt-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setCursor(event.target.selectionStart ?? event.target.value.length);
              onQueryChange(event.target.value);
            }}
            onFocus={(event) => {
              setFocused(true);
              setCursor(event.target.selectionStart ?? event.target.value.length);
            }}
            onClick={(event) => setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
            onKeyDown={(event) => {
              event.stopPropagation();

              if (suggestions.length === 0) {
                return;
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
                return;
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
                return;
              }

              if ((event.key === 'Enter' || event.key === 'Tab') && activeSuggestion) {
                event.preventDefault();
                applyField(activeSuggestion.key);
                return;
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setFocused(false);
                setActiveSuggestionIndex(0);
              }
            }}
            onKeyUp={(event) => setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
            onBlur={() => setFocused(false)}
            placeholder='type:page AND status:active AND area:architecture'
            aria-label="Lucene query"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-activedescendant={activeSuggestion ? `companion-lucene-query-suggestion-${activeSuggestion.key}` : undefined}
            className={QUERY_INPUT_CLASS}
            autoComplete="off"
            spellCheck={false}
          />
          {suggestions.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg shadow-black/20" role="listbox" aria-label="Lucene query field suggestions">
              {suggestions.map((field, index) => {
                const selected = index === activeSuggestionIndex;
                return (
                  <button
                    key={field.key}
                    id={`companion-lucene-query-suggestion-${field.key}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                    onClick={() => applyField(field.key)}
                    className={cx(
                      'flex w-full items-start justify-between gap-3 border-t border-border-subtle px-3 py-2.5 text-left first:border-t-0 hover:bg-surface-hover',
                      selected && 'bg-surface-hover',
                    )}
                  >
                    <span className="font-mono text-[12px] text-primary">{field.key}:</span>
                    <span className="text-[11px] text-dim">{field.detail}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </label>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
        <span>{visibleCount} visible</span>
        <span className="opacity-40">·</span>
        <span>Insert field</span>
        {CORE_QUERY_FIELDS.map((field) => (
          <button
            key={field.key}
            type="button"
            onClick={() => applyField(field.key)}
            className="font-mono text-secondary transition-colors hover:text-primary"
          >
            {field.key}:
          </button>
        ))}
      </div>
    </div>
  );
}

function comparePages(left: NodeBrowserSummary, right: NodeBrowserSummary): number {
  const leftOrder = PAGE_KIND_ORDER.indexOf(left.kind);
  const rightOrder = PAGE_KIND_ORDER.indexOf(right.kind);
  return leftOrder - rightOrder
    || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
    || left.title.localeCompare(right.title)
    || left.id.localeCompare(right.id);
}

function buildPageLabel(page: NodeBrowserSummary): string {
  const base = kindLabel(page.kind);
  return page.status === 'archived' ? `Archived ${base.toLowerCase()}` : base;
}

function buildPageAside(page: NodeBrowserSummary): string | null {
  switch (page.kind) {
    case 'project':
      return humanizeStatus(page.status);
    case 'note': {
      const referenceCount = page.note?.referenceCount ?? 0;
      return referenceCount > 0 ? `${referenceCount} ${referenceCount === 1 ? 'ref' : 'refs'}` : null;
    }
    case 'skill':
      return page.skill?.usedInLastSession ? 'Used recently' : null;
  }
}

function buildPageMeta(page: NodeBrowserSummary): string {
  const parts = [
    humanizeStatus(page.status),
    page.updatedAt ? `updated ${timeAgo(page.updatedAt)}` : null,
    page.kind === 'project'
      ? page.project?.profile ?? page.profiles[0] ?? null
      : page.kind === 'skill'
        ? page.skill?.source ?? null
        : page.note?.area ?? null,
    `@${page.id}`,
  ].filter((value): value is string => Boolean(value));

  return parts.join(' · ');
}

function filterPages(pages: NodeBrowserSummary[], filter: NodeBrowserFilter, query: string): NodeBrowserSummary[] {
  return pages
    .filter((page) => filter === 'all' ? true : filter === 'skill' ? page.kind === 'skill' : page.kind !== 'skill')
    .filter((page) => matchesNodeBrowserQuery(page, query))
    .sort(comparePages);
}

function CompanionSelectedPageView({
  selection,
  page,
  onBack,
}: {
  selection: { kind: NodeLinkKind; id: string };
  page: NodeBrowserSummary | null;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border-subtle px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] font-medium text-accent transition-colors hover:text-accent/80"
        >
          ← Back to docs
        </button>
      </div>

      {!page ? (
        <div className="px-4 py-5">
          <p className="text-[15px] text-primary">Doc not found.</p>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">@{selection.id} is not available in the current docs store.</p>
        </div>
      ) : selection.kind === 'project' ? (
        <CompanionProjectDetailPage projectId={selection.id} />
      ) : selection.kind === 'note' ? (
        <CompanionMemoryDetailPage memoryId={selection.id} />
      ) : (
        <CompanionSkillDetailPage skillName={selection.id} />
      )}
    </div>
  );
}

export function CompanionKnowledgePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, loading, refreshing, error, refetch } = useApi(api.nodes, 'companion-pages');
  const { setTopBarRightAction } = useCompanionTopBarAction();
  const filter = readNodeBrowserFilter(location.search);
  const query = readNodeBrowserQuery(location.search);
  const selected = readSelectedNode(location.search);

  const pages = useMemo(() => data?.nodes ?? [], [data?.nodes]);
  const visiblePages = useMemo(() => filterPages(pages, filter, query), [filter, pages, query]);
  const groupedPages = useMemo(() => {
    const pageItems = visiblePages.filter((page) => page.kind !== 'skill');
    const skillItems = visiblePages.filter((page) => page.kind === 'skill');
    return [
      ...(pageItems.length > 0 ? [{ kind: 'page' as const, items: pageItems }] : []),
      ...(skillItems.length > 0 ? [{ kind: 'skill' as const, items: skillItems }] : []),
    ];
  }, [visiblePages]);
  const countsByKind = useMemo(() => ({
    page: pages.filter((page) => page.kind !== 'skill').length,
    skill: pages.filter((page) => page.kind === 'skill').length,
  }), [pages]);
  const selectedPage = useMemo(
    () => selected ? pages.find((page) => page.kind === selected.kind && page.id === selected.id) ?? null : null,
    [pages, selected],
  );

  const updateSearch = useCallback((updates: { filter?: NodeBrowserFilter | null; query?: string | null }) => {
    navigate({
      pathname: COMPANION_PAGES_PATH,
      search: buildNodesSearch(location.search, {
        filter: updates.filter,
        query: updates.query,
        kind: null,
        nodeId: null,
      }),
    }, { replace: true });
  }, [location.search, navigate]);

  const clearSelection = useCallback(() => {
    navigate({
      pathname: COMPANION_PAGES_PATH,
      search: buildNodesSearch(location.search, { kind: null, nodeId: null }),
    }, { replace: true });
  }, [location.search, navigate]);

  useEffect(() => {
    setTopBarRightAction(
      <button
        type="button"
        onClick={() => { void refetch({ resetLoading: false }); }}
        disabled={refreshing}
        className="flex h-9 items-center rounded-full px-3 text-[12px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>,
    );
    return () => setTopBarRightAction(undefined);
  }, [refreshing, refetch, setTopBarRightAction]);

  if (selected) {
    return <CompanionSelectedPageView selection={selected} page={selectedPage} onBack={clearSelection} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          <section className="px-4">
            <div className="space-y-3">
              <div>
                <p className="text-[15px] font-medium text-primary">Browse all durable docs from your phone.</p>
                <p className="mt-1 text-[13px] leading-relaxed text-secondary">
                  Use Lucene-style filters like <span className="font-mono text-[12px] text-primary">type:page AND status:active</span>, then open any doc inline without leaving the Docs surface.
                </p>
              </div>

              <LuceneQueryInput query={query} visibleCount={visiblePages.length} onQueryChange={(value) => updateSearch({ query: value })} />

              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-dim">View</span>
                  <select
                    value={filter}
                    onChange={(event) => updateSearch({ filter: event.target.value as NodeBrowserFilter })}
                    className={`${SELECT_CLASS} mt-2`}
                  >
                    {FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div className="text-[12px] text-secondary sm:text-right">
                  {pages.length} total · {countsByKind.page} docs · {countsByKind.skill} skills
                </div>
              </div>

            </div>
          </section>

          {loading ? <p className="px-4 pt-5 text-[13px] text-dim">Loading docs…</p> : null}
          {!loading && error ? <p className="px-4 pt-5 text-[13px] text-danger">Unable to load docs: {error}</p> : null}
          {!loading && !error && pages.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No docs yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Create or sync docs in the main workspace and they will appear here automatically.
              </p>
            </div>
          ) : null}
          {!loading && !error && pages.length > 0 && visiblePages.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No docs match this query.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Try a broader filter or clear the Lucene query.
              </p>
            </div>
          ) : null}
          {!loading && !error && groupedPages.map((group) => (
            <CompanionSection key={group.kind} title={`${pluralKindLabel(group.kind)} · ${group.items.length}`}>
              {group.items.map((page) => (
                <BrowserRecordRow
                  key={`${page.kind}:${page.id}`}
                  to={buildCompanionPagePath(page.kind, page.id)}
                  label={buildPageLabel(page)}
                  aside={buildPageAside(page)}
                  heading={page.title}
                  summary={page.summary || page.description || '(no summary)'}
                  meta={buildPageMeta(page)}
                  className="py-3.5"
                  titleClassName="text-[15px]"
                  summaryClassName="text-[13px]"
                  metaClassName="text-[11px] break-words"
                />
              ))}
            </CompanionSection>
          ))}
        </div>
      </div>
    </div>
  );
}
