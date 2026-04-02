import { useMemo } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type { MemorySkillItem } from '../types';
import { BrowserRecordRow } from '../components/ui';
import { buildCompanionPagePath } from './routes';

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
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          {loading ? <p className="px-4 text-[13px] text-dim">Loading skills…</p> : null}
          {!loading && error ? <p className="px-4 text-[13px] text-danger">Unable to load skills: {error}</p> : null}
          {!loading && !error && skills.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">No skills yet.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                Add or sync profile skills in the main workspace and they will appear here automatically.
              </p>
            </div>
          ) : null}
          {!loading && !error && skills.length > 0 ? (
            <section className="px-4">
              <div className="space-y-2">
                {skills.map((skill) => (
                  <BrowserRecordRow
                    key={skill.name}
                    to={buildCompanionPagePath('skill', skill.name)}
                    label={skill.source === 'shared' ? 'Shared skill' : 'Custom skill'}
                    aside={skill.usedInLastSession ? 'Used recently' : null}
                    heading={humanizeSkillName(skill.name)}
                    summary={skill.description}
                    meta={`${formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} · ${skill.source}`}
                    className="py-3.5"
                    titleClassName="text-[15px]"
                    summaryClassName="text-[13px]"
                    metaClassName="text-[11px] break-words"
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
