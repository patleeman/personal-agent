import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { getKnowledgeSkillName } from '../knowledgeSelection';
import type { MemorySkillItem } from '../types';
import { humanizeSkillName, formatUsageLabel } from '../memoryOverview';
import {
  EmptyState,
  ErrorState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';

const SKILL_SEARCH_PARAM = 'skill';
const INPUT_CLASS = 'w-full max-w-xl rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';

function matchesSkill(skill: MemorySkillItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const haystack = [
    skill.name,
    humanizeSkillName(skill.name),
    skill.description,
    skill.source,
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function sortSkills(items: MemorySkillItem[]): MemorySkillItem[] {
  return [...items].sort((left, right) => {
    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
      || humanizeSkillName(left.name).localeCompare(humanizeSkillName(right.name));
  });
}

function buildSkillsSearch(locationSearch: string, skillName: string | null): string {
  const params = new URLSearchParams(locationSearch);

  if (skillName) {
    params.set(SKILL_SEARCH_PARAM, skillName);
  } else {
    params.delete(SKILL_SEARCH_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function SkillsPage() {
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

  const skills = useMemo(() => sortSkills(data?.skills ?? []), [data?.skills]);
  const filteredSkills = useMemo(() => skills.filter((skill) => matchesSkill(skill, query)), [query, skills]);
  const selectedSkillName = useMemo(() => getKnowledgeSkillName(location.search), [location.search]);

  const setSelectedSkill = useCallback((skillName: string | null, replace = false) => {
    const nextSearch = buildSkillsSearch(location.search, skillName);
    navigate(`/skills${nextSearch}`, { replace });
  }, [location.search, navigate]);

  useEffect(() => {
    if (loading || !selectedSkillName) {
      return;
    }

    if (skills.some((skill) => skill.name === selectedSkillName)) {
      return;
    }

    setSelectedSkill(null, true);
  }, [loading, selectedSkillName, setSelectedSkill, skills]);

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
          title="Skills"
          meta={(
            <>
              {skills.length} {skills.length === 1 ? 'skill' : 'skills'}
              {selectedSkillName && <span className="ml-2 text-secondary">· {humanizeSkillName(selectedSkillName)}</span>}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 px-6 py-4">
        {loading && <LoadingState label="Loading skills…" />}
        {error && <ErrorState message={`Unable to load skills: ${error}`} />}

        {!loading && !error && skills.length === 0 && (
          <EmptyState
            title="No skills yet."
            body="Add a skill to the active profile to make reusable workflows available to the agent."
          />
        )}

        {!loading && !error && skills.length > 0 && (
          <div className="space-y-5 pb-5">
            <div className="space-y-2">
              <p className="ui-card-meta">Skills are reusable procedures and workflows the agent can invoke when the topic matches. Inspect the selected skill in the right sidebar.</p>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search skills, descriptions, or names"
                aria-label="Search skills"
                className={INPUT_CLASS}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="ui-card-meta">
                {query.trim()
                  ? `Showing ${filteredSkills.length} of ${skills.length} skills.`
                  : 'Search across skill names, descriptions, and sources.'}
              </p>
            </div>

            {filteredSkills.length === 0 ? (
              <EmptyState
                title="No skills match that search"
                body="Try a broader search across skill names and descriptions."
              />
            ) : (
              <div className="space-y-px">
                {filteredSkills.map((skill) => (
                  <ListLinkRow
                    key={skill.name}
                    to={`/skills${buildSkillsSearch(location.search, skill.name)}`}
                    selected={skill.name === selectedSkillName}
                    leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${skill.usedInLastSession ? 'bg-accent' : 'bg-teal'}`} />}
                  >
                    <p className="ui-row-title">{humanizeSkillName(skill.name)}</p>
                    <p className="ui-row-summary">{skill.description}</p>
                    <p className="ui-row-meta break-words">{formatUsageLabel(skill.recentSessionCount, skill.lastUsedAt, skill.usedInLastSession, 'Not used recently')} · {skill.source}</p>
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
