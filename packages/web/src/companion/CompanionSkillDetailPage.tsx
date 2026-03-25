import { useCallback, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type { MemorySkillItem } from '../types';
import { CompanionMarkdown } from './CompanionMarkdown';
import { COMPANION_SKILLS_PATH } from './routes';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-subtle px-4 py-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

interface CompanionSkillDetailData {
  skill: MemorySkillItem;
  content: string;
}

export function CompanionSkillDetailPage() {
  const { name } = useParams<{ name: string }>();
  const fetchSkill = useCallback(async (): Promise<CompanionSkillDetailData> => {
    if (!name) {
      throw new Error('Missing skill name.');
    }

    const memory = await api.memory();
    const skill = memory.skills.find((entry) => entry.name === name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const file = await api.memoryFile(skill.path);
    return {
      skill,
      content: file.content,
    };
  }, [name]);
  const { data, loading, refreshing, error, refetch } = useApi(fetchSkill, `companion-skill:${name ?? ''}`);

  const skill = data?.skill ?? null;
  const usageLabel = useMemo(() => {
    if (!skill) {
      return null;
    }

    return formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently');
  }, [skill]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="flex items-center justify-between gap-3">
            <Link to={COMPANION_SKILLS_PATH} className="text-[12px] font-medium text-accent">← Skills</Link>
            <button
              type="button"
              onClick={() => { void refetch({ resetLoading: false }); }}
              disabled={refreshing}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10 hover:text-accent/80 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">{skill ? humanizeSkillName(skill.name) : 'Skill'}</h1>
          {skill ? (
            <>
              <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">{skill.description}</p>
              <p className="mt-3 break-words text-[12px] text-dim">{[usageLabel, skill.source, `@${skill.name}`].filter(Boolean).join(' · ')}</p>
            </>
          ) : null}
        </div>
      </header>

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
                <CompanionMarkdown content={data.content} />
              </Section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
