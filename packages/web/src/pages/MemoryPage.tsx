import { type ReactNode, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import {
  buildCapabilityCards,
  buildIdentitySummary,
  buildKnowledgeSections,
  buildMemoryPageSummary,
  type CapabilityCardModel,
  type KnowledgeCardModel,
} from '../memoryOverview';
import {
  ErrorState,
  ListButtonRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface';

function MemoryRow({
  title,
  summary,
  meta,
  trailing,
  selected,
  onClick,
}: {
  title: string;
  summary?: string;
  meta?: ReactNode;
  trailing?: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <ListButtonRow
      onClick={onClick}
      selected={selected}
      className="w-full text-left"
      leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border-default/60" />}
    >
      <div className="space-y-1.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <span className="ui-row-title font-medium">{title}</span>
          {trailing && <div className="flex items-center gap-2 flex-wrap shrink-0">{trailing}</div>}
        </div>
        {summary && <p className="ui-row-summary line-clamp-3">{summary}</p>}
        {meta && <div className="ui-row-meta">{meta}</div>}
      </div>
    </ListButtonRow>
  );
}

function SectionHeader({
  label,
  title,
  description,
  count,
}: {
  label: string;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <p className="ui-section-label">{label}</p>
        {typeof count === 'number' && <span className="ui-section-count">{count}</span>}
      </div>
      <p className="text-[15px] font-medium text-primary">{title}</p>
      <p className="ui-card-meta max-w-3xl">{description}</p>
    </div>
  );
}

function CapabilityRow({
  item,
  selected,
  onSelect,
}: {
  item: CapabilityCardModel;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const meta = [item.sourceLabel, item.usageLabel].filter(Boolean).join(' · ');

  return (
    <MemoryRow
      title={item.title}
      summary={item.whenToUse}
      meta={meta}
      selected={selected}
      onClick={() => onSelect(item.item.path)}
    />
  );
}

function KnowledgeRow({
  item,
  selected,
  onSelect,
}: {
  item: KnowledgeCardModel;
  selected: boolean;
  onSelect: (path: string) => void;
}) {
  const meta = item.tags.length > 0
    ? `${item.usageLabel} · ${item.tags.join(' · ')}`
    : item.usageLabel;

  return (
    <MemoryRow
      title={item.title}
      summary={item.summary}
      meta={meta}
      selected={selected}
      onClick={() => onSelect(item.item.path)}
    />
  );
}

export function MemoryPage() {
  const { data, loading, error, refetch } = useApi(api.memory);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedPath = new URLSearchParams(location.search).get('item') ?? null;
  const [query, setQuery] = useState('');

  function updateSearch(updates: { item?: string | null }) {
    const next = new URLSearchParams(location.search);

    if (updates.item !== undefined) {
      if (!updates.item) {
        next.delete('item');
      } else {
        next.set('item', updates.item);
      }
    }

    const queryString = next.toString();
    navigate(queryString ? `/memory?${queryString}` : '/memory', { replace: true });
  }

  function select(path: string) {
    updateSearch({ item: selectedPath === path ? null : path });
  }

  const derived = useMemo(() => {
    if (!data) {
      return null;
    }

    return {
      summary: buildMemoryPageSummary(data),
      identity: buildIdentitySummary(data),
      capabilities: buildCapabilityCards(data, query),
      knowledge: buildKnowledgeSections(data, query),
    };
  }, [data, query]);

  const knowledgeCount = derived
    ? derived.knowledge.patterns.length + derived.knowledge.references.length
    : 0;

  return (
    <div className="flex flex-col h-full">
      <PageHeader actions={<ToolbarButton onClick={() => { void refetch(); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading title="Agent Memory" />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading memory…" />}
        {error && <ErrorState message={`Failed to load memory: ${error}`} />}

        {!loading && data && derived && (
          <div className="space-y-6 pb-5">
            <div className="space-y-2">
              <p className="text-[14px] leading-relaxed text-secondary max-w-3xl">
                Identity, knowledge, and capabilities persist across conversations.
              </p>
              <p className="ui-card-meta">
                {derived.summary.role}
                {' · '}
                {derived.summary.knowledgeCount} {derived.summary.knowledgeCount === 1 ? 'knowledge item' : 'knowledge items'}
                {' · '}
                {derived.summary.capabilityCount} {derived.summary.capabilityCount === 1 ? 'capability' : 'capabilities'}
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="memory-search" className="ui-section-label">Search memory</label>
              <input
                id="memory-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search knowledge and capabilities"
                className={INPUT_CLASS}
                autoComplete="off"
              />
              <p className="ui-card-meta">
                {query.trim().length > 0
                  ? `Showing ${derived.capabilities.length + knowledgeCount} matching ${derived.capabilities.length + knowledgeCount === 1 ? 'item' : 'items'}.`
                  : 'Search names, descriptions, summaries, and tags.'}
              </p>
            </div>

            <section className="space-y-3 border-t border-border-subtle pt-5">
              <SectionHeader
                label="Identity"
                title="Role and behavior"
                description="Core rules and boundaries that shape every response."
                count={derived.identity.ruleCount}
              />

              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="ui-section-label">Role</p>
                  <p className="ui-card-body text-primary">{derived.identity.role}</p>
                </div>

                <div className="space-y-2">
                  <p className="ui-section-label">Behavior rules</p>
                  <ul className="space-y-2">
                    {derived.identity.behaviorRules.map((rule) => (
                      <li key={rule} className="flex items-start gap-2 text-[13px] leading-relaxed text-secondary">
                        <span className="mt-[2px] shrink-0 text-dim">•</span>
                        <span>{rule}</span>
                      </li>
                    ))}
                  </ul>
                  {derived.identity.ruleCount > derived.identity.behaviorRules.length && (
                    <p className="ui-card-meta">+{derived.identity.ruleCount - derived.identity.behaviorRules.length} more rules in the full definition</p>
                  )}
                </div>

                {derived.identity.primaryItem && (
                  <div>
                    <button
                      type="button"
                      onClick={() => updateSearch({ item: derived.identity.primaryItem?.path ?? null })}
                      className={ACTION_BUTTON_CLASS}
                    >
                      View & edit core instructions
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-4 border-t border-border-subtle pt-5">
              <SectionHeader
                label="Knowledge"
                title="Learned notes and references"
                description="Patterns and reference material the agent can pull forward later."
                count={knowledgeCount}
              />

              {derived.summary.knowledgeCount === 0 ? (
                <p className="ui-card-meta">No learned knowledge yet.</p>
              ) : (
                <div className="space-y-4">
                  {derived.knowledge.recent.length > 0 && (
                    <div className="space-y-2">
                      <p className="ui-section-label">Recently used</p>
                      <div className="space-y-px">
                        {derived.knowledge.recent.map((item) => (
                          <KnowledgeRow
                            key={`recent-${item.item.path}`}
                            item={item}
                            selected={selectedPath === item.item.path}
                            onSelect={select}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {derived.knowledge.patterns.length > 0 && (
                    <div className="space-y-2">
                      <p className="ui-section-label">Learned patterns</p>
                      <div className="space-y-px">
                        {derived.knowledge.patterns.map((item) => (
                          <KnowledgeRow
                            key={item.item.path}
                            item={item}
                            selected={selectedPath === item.item.path}
                            onSelect={select}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {derived.knowledge.references.length > 0 && (
                    <div className="space-y-2">
                      <p className="ui-section-label">Reference materials</p>
                      <div className="space-y-px">
                        {derived.knowledge.references.map((item) => (
                          <KnowledgeRow
                            key={item.item.path}
                            item={item}
                            selected={selectedPath === item.item.path}
                            onSelect={select}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {knowledgeCount === 0 && <p className="ui-card-meta">No knowledge matches this search.</p>}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-border-subtle pt-5">
              <SectionHeader
                label="Capabilities"
                title="Reusable skills"
                description="Skills, tools, and workflows available to the agent."
                count={derived.capabilities.length}
              />

              {derived.capabilities.length === 0 ? (
                <p className="ui-card-meta">No capabilities match this search.</p>
              ) : (
                <div className="space-y-px">
                  {derived.capabilities.map((item) => (
                    <CapabilityRow
                      key={item.item.path}
                      item={item}
                      selected={selectedPath === item.item.path}
                      onSelect={select}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
