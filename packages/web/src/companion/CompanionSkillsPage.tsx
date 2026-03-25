import { useMemo } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type { MemorySkillItem } from '../types';

function sortCompanionSkills(skills: MemorySkillItem[]): MemorySkillItem[] {
  return [...skills].sort((left, right) => {
    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
      || humanizeSkillName(left.name).localeCompare(humanizeSkillName(right.name));
  });
}

export function CompanionSkillsPage() {
  const { data, loading, error } = useApi(api.memory, 'companion-skills');
  const skills = useMemo(() => sortCompanionSkills(data?.skills ?? []), [data?.skills]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">Skills</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">
            Check which reusable workflows are available to the agent before you steer the next conversation turn.
          </p>
          <p className="mt-3 text-[12px] text-dim">
            {skills.length === 0 ? 'No skills available.' : `${skills.length} skill${skills.length === 1 ? '' : 's'} available.`}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading skills…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load skills: {error}</p> : null}
          {!loading && !error && skills.length === 0 ? (
            <div className="px-4 pt-6">
              <p className="text-[15px] text-primary">No skills yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Add or sync profile skills in the main workspace and they will appear here automatically.
              </p>
            </div>
          ) : null}
          {!loading && !error && skills.length > 0 ? (
            <section>
              <div className="border-y border-border-subtle">
                {skills.map((skill) => (
                  <div key={skill.name} className="border-b border-border-subtle px-4 py-4 last:border-b-0">
                    <h3 className="truncate text-[16px] font-medium leading-tight text-primary">{humanizeSkillName(skill.name)}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-secondary">{skill.description}</p>
                    <p className="mt-2 break-words text-[11px] text-dim">
                      {formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} · {skill.source}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
