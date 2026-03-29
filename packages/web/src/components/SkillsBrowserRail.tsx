import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { BrowserRecordRow, EmptyState, ErrorState, LoadingState, ToolbarButton } from './ui';
import { formatUsageLabel, humanizeSkillName } from '../memoryOverview';
import {
  buildSkillsSearch,
  matchesSkill,
  SKILL_ITEM_SEARCH_PARAM,
  sortSkills,
} from '../skillWorkspaceState';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function skillRecordLabel(source: string): string {
  return source === 'shared' ? 'Shared skill' : 'Custom skill';
}

export function SkillsBrowserRail() {
  const location = useLocation();
  const { data, loading, error, refreshing, refetch } = useApi(api.memory);
  const [query, setQuery] = useState('');
  const skills = useMemo(() => sortSkills(data?.skills ?? []), [data?.skills]);
  const filteredSkills = useMemo(() => skills.filter((skill) => matchesSkill(skill, query)), [query, skills]);
  const selectedSkillName = useMemo(() => new URLSearchParams(location.search).get('skill')?.trim() || null, [location.search]);
  const selectedItem = useMemo(() => new URLSearchParams(location.search).get(SKILL_ITEM_SEARCH_PARAM)?.trim() || null, [location.search]);
  const selectedSkill = skills.find((skill) => skill.name === selectedSkillName) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border-subtle px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-card-title">Skills</p>
            <p className="ui-card-meta mt-1">Browse reusable workflows and open them in the main workspace.</p>
          </div>
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻'}
          </ToolbarButton>
        </div>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search skills"
          className={INPUT_CLASS}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="ui-card-meta">
          {query.trim() ? `Showing ${filteredSkills.length} of ${skills.length}.` : `${skills.length} skills.`}
          {selectedSkillName ? ` Selected ${humanizeSkillName(selectedSkillName)}.` : ''}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading && !data ? <LoadingState label="Loading skills…" className="px-0 py-0" /> : null}
        {error && !data ? <ErrorState message={`Unable to load skills: ${error}`} className="px-0 py-0" /> : null}

        {!loading && !error && filteredSkills.length === 0 ? (
          <EmptyState
            className="py-8"
            title={skills.length === 0 ? 'No skills yet' : 'No matches'}
            body={skills.length === 0 ? 'Add a skill to the active profile to create reusable workflows.' : 'Try a broader search across skill names and descriptions.'}
          />
        ) : null}

        {!loading && !error && filteredSkills.length > 0 && (
          <div className="space-y-1">
            {filteredSkills.map((skill) => (
              <BrowserRecordRow
                key={skill.name}
                to={`/skills${buildSkillsSearch(location.search, { skillName: skill.name, view: null, item: null })}`}
                selected={skill.name === selectedSkillName}
                label={skillRecordLabel(skill.source)}
                aside={skill.usedInLastSession ? 'Used recently' : null}
                heading={humanizeSkillName(skill.name)}
                summary={skill.description}
                meta={(
                  <>
                    <span className="font-mono">{skill.name}</span>
                    <span className="opacity-40">·</span>
                    <span>{formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')}</span>
                    {skill.source !== 'shared' && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>source {skill.source}</span>
                      </>
                    )}
                  </>
                )}
              />
            ))}
          </div>
        )}

        {selectedSkill && (
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Inspector</p>
            <p className="ui-card-meta">References and relationships open in the right-hand inspector instead of separate resource pages.</p>
            <p className="ui-card-meta">
              {selectedItem ? `Editing reference ${selectedItem}.` : 'Editing the main skill definition.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
