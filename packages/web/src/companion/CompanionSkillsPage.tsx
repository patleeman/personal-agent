import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import type { MemorySkillItem } from '../types';
import { buildCompanionSkillPath } from './routes';

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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h1 className="text-[22px] font-semibold tracking-tight text-primary">Skills</h1>
          <p className="mt-1 text-[11px] text-dim">
            {skills.length === 0 ? 'No skills yet.' : `${skills.length} skills available`}
          </p>
        </div>
      </header>

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
            <section>
              <div className="border-y border-border-subtle">
                {skills.map((skill) => (
                  <Link
                    key={skill.name}
                    to={buildCompanionSkillPath(skill.name)}
                    className="block border-b border-border-subtle px-4 py-3.5 transition-colors last:border-b-0 hover:bg-surface/55"
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-medium leading-tight text-primary">{humanizeSkillName(skill.name)}</h3>
                        <p className="mt-1 text-[12px] leading-relaxed text-secondary">{skill.description}</p>
                        <p className="mt-2 break-words text-[11px] text-dim">
                          {formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} · {skill.source}
                        </p>
                      </div>
                      <span className="pt-0.5 text-accent" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m9 6 6 6-6 6" />
                        </svg>
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
