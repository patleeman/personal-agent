import { useCallback, useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';

import type { SkillDetail } from '../types';
import { NodeLinkList, UnresolvedNodeLinks } from '../components/NodeLinksSection';
import { CompanionMarkdown } from './CompanionMarkdown';

import { useCompanionTopBarAction } from './CompanionLayout';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function CompanionSkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const fetchSkill = useCallback(async (): Promise<SkillDetail> => {
    if (!name) {
      throw new Error('Missing skill name.');
    }

    return api.skillDetail(name);
  }, [name]);
  const { data, loading, refreshing, error, refetch } = useApi(fetchSkill, `companion-skill:${name ?? ''}`);

  const skill = data?.skill ?? null;
  const { setTopBarRightAction } = useCompanionTopBarAction();

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading skill…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load skill: {error}</p> : null}
          {!loading && !error && !data ? <p className="px-4 text-[13px] text-dim">Skill not found.</p> : null}

          {data && skill ? (
            <div className="overflow-hidden border-y border-border-subtle bg-surface/70">
              <Section title="Use in conversation">
                <p className="text-[13px] leading-relaxed text-secondary">
                  Refer to this workflow from the companion with <code>/skill:{skill.name}</code> after you take over the conversation on this device.
                </p>
              </Section>

              <Section title="Definition">
                <CompanionMarkdown content={data.content} stripFrontmatter />
              </Section>

              <Section title="Relationships">
                <NodeLinkList
                  title="Links to"
                  items={data.links?.outgoing}
                  surface="companion"
                  emptyText="This skill does not reference other pages yet."
                />
                <NodeLinkList
                  title="Linked from"
                  items={data.links?.incoming}
                  surface="companion"
                  emptyText="No other pages link to this skill yet."
                />
                <UnresolvedNodeLinks ids={data.links?.unresolved} />
              </Section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
