import type { MemorySkillItem } from '../types';
import { humanizeSkillName } from './memoryOverview';

export const SKILL_SEARCH_PARAM = 'skill';
export const SKILL_VIEW_SEARCH_PARAM = 'view';
export const SKILL_ITEM_SEARCH_PARAM = 'item';

export type SkillWorkspaceView = 'definition' | 'references' | 'links';

export function matchesSkill(skill: MemorySkillItem, query: string): boolean {
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

export function sortSkills(items: MemorySkillItem[]): MemorySkillItem[] {
  return [...items].sort((left, right) => {
    const leftUsage = Number(left.usedInLastSession) * 10 + (left.recentSessionCount ?? 0);
    const rightUsage = Number(right.usedInLastSession) * 10 + (right.recentSessionCount ?? 0);
    return rightUsage - leftUsage
      || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '')
      || humanizeSkillName(left.name).localeCompare(humanizeSkillName(right.name));
  });
}

export function readSkillView(search: string): SkillWorkspaceView {
  const value = new URLSearchParams(search).get(SKILL_VIEW_SEARCH_PARAM)?.trim();
  return value === 'references' || value === 'links' ? value : 'definition';
}

export function buildSkillsSearch(locationSearch: string, updates: {
  skillName?: string | null;
  view?: SkillWorkspaceView | null;
  item?: string | null;
}): string {
  const params = new URLSearchParams(locationSearch);

  if (updates.skillName !== undefined) {
    if (updates.skillName) {
      params.set(SKILL_SEARCH_PARAM, updates.skillName);
    } else {
      params.delete(SKILL_SEARCH_PARAM);
    }
  }

  if (updates.view !== undefined) {
    if (updates.view) {
      params.set(SKILL_VIEW_SEARCH_PARAM, updates.view);
    } else {
      params.delete(SKILL_VIEW_SEARCH_PARAM);
    }
  }

  if (updates.item !== undefined) {
    if (updates.item) {
      params.set(SKILL_ITEM_SEARCH_PARAM, updates.item);
    } else {
      params.delete(SKILL_ITEM_SEARCH_PARAM);
    }
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}
