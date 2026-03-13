import type { MemorySkillItem } from './types';

export interface SlashMenuItem {
  key: string;
  insertText: string;
  displayCmd: string;
  icon: string;
  desc: string;
  section: 'Commands' | 'Skills';
  source?: string;
  kind: 'command' | 'skill';
}

export const BASE_SLASH_COMMANDS = [
  { cmd: '/model', icon: '⊕', desc: 'Select model (opens selector UI)' },
  { cmd: '/export', icon: '⇪', desc: 'Export session to HTML file' },
  { cmd: '/copy', icon: '⎘', desc: 'Copy last agent message to clipboard' },
  { cmd: '/name', icon: '✎', desc: 'Set session display name' },
  { cmd: '/session', icon: 'ⓘ', desc: 'Show session info and stats' },
  { cmd: '/fork', icon: '⑂', desc: 'Create a new fork from a previous message' },
  { cmd: '/tree', icon: '⎇', desc: 'Navigate session tree (switch branches)' },
  { cmd: '/new', icon: '↺', desc: 'Start a new session' },
  { cmd: '/compact', icon: '≡', desc: 'Manually compact the session context' },
  { cmd: '/reload', icon: '↻', desc: 'Reload extensions, skills, prompts, and themes' },
  { cmd: '/project', icon: '◫', desc: 'Create or reference a project for this conversation' },
  { cmd: '/resume', icon: '⏰', desc: 'Schedule this conversation to continue later' },
] as const;

export interface ParsedSlashInput {
  command: string;
  argument: string;
}

export function parseSlashInput(input: string): ParsedSlashInput | null {
  if (!input.startsWith('/')) {
    return null;
  }

  const firstWhitespaceIndex = input.search(/\s/);
  if (firstWhitespaceIndex === -1) {
    return { command: input, argument: '' };
  }

  return {
    command: input.slice(0, firstWhitespaceIndex),
    argument: input.slice(firstWhitespaceIndex).trimStart(),
  };
}

function normalizeSlashQuery(query: string): string {
  return query.startsWith('/') ? query.slice(1).toLowerCase() : query.toLowerCase();
}

function normalizeFuzzyText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function fuzzyScore(query: string, candidate: string): number | null {
  const normalizedQuery = normalizeFuzzyText(query);
  const normalizedCandidate = normalizeFuzzyText(candidate);

  if (normalizedQuery.length === 0) {
    return 0;
  }

  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -2;

  for (let candidateIndex = 0; candidateIndex < normalizedCandidate.length; candidateIndex += 1) {
    if (normalizedCandidate[candidateIndex] !== normalizedQuery[queryIndex]) {
      continue;
    }

    if (firstMatchIndex === -1) {
      firstMatchIndex = candidateIndex;
    }

    if (candidateIndex === lastMatchIndex + 1) {
      consecutiveBonus += 3;
    } else {
      consecutiveBonus = 0;
    }

    score += 10 + consecutiveBonus;
    lastMatchIndex = candidateIndex;
    queryIndex += 1;

    if (queryIndex === normalizedQuery.length) {
      break;
    }
  }

  if (queryIndex !== normalizedQuery.length) {
    return null;
  }

  if (firstMatchIndex === 0) {
    score += 12;
  }

  score += Math.max(0, 18 - (normalizedCandidate.length - normalizedQuery.length));
  return score;
}

function getExplicitSkillFilterQuery(query: string): string | null {
  const normalized = normalizeSlashQuery(query).trim();

  if (normalized.startsWith('skill:')) {
    return normalized.slice('skill:'.length);
  }

  if (normalized.startsWith('skill ')) {
    return normalized.slice('skill '.length).trim();
  }

  if (normalized === 'skills') {
    return '';
  }

  if (normalized.length >= 3 && fuzzyScore(normalized, 'skill') !== null) {
    return '';
  }

  return null;
}

function scoreSkill(query: string, skill: MemorySkillItem, slashQuery: string, explicitSkillQuery: boolean): number | null {
  if (query.length === 0) {
    return 0;
  }

  const nameScore = fuzzyScore(query, skill.name);
  const descScore = fuzzyScore(query, skill.description);

  if (explicitSkillQuery) {
    return nameScore ?? (descScore !== null ? Math.max(1, Math.floor(descScore / 3)) : null);
  }

  const slashCommandScore = fuzzyScore(slashQuery, `skill:${skill.name}`);
  const bestNameOrCommandScore = Math.max(nameScore ?? 0, slashCommandScore ?? 0);

  if (bestNameOrCommandScore > 0) {
    return bestNameOrCommandScore;
  }

  if (descScore !== null) {
    return Math.max(1, Math.floor(descScore / 3));
  }

  return null;
}

export function buildSlashMenuItems(query: string, skills: MemorySkillItem[]): SlashMenuItem[] {
  const parsedInput = parseSlashInput(query);
  const commandQuery = parsedInput?.command ?? query;
  const normalized = normalizeSlashQuery(commandQuery);

  const commandItems: SlashMenuItem[] = BASE_SLASH_COMMANDS
    .map((command) => ({ command, score: normalized.length === 0 ? 0 : fuzzyScore(normalized, command.cmd.slice(1)) }))
    .filter((entry) => normalized.length === 0 || entry.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.command.cmd.localeCompare(right.command.cmd))
    .map(({ command }) => ({
      key: command.cmd,
      insertText: `${command.cmd} `,
      displayCmd: command.cmd,
      icon: command.icon,
      desc: command.desc,
      section: 'Commands',
      kind: 'command',
    }));

  const explicitSkillQuery = getExplicitSkillFilterQuery(query);
  const skillQuery = explicitSkillQuery ?? (normalized.length > 0 ? normalized : null);
  const skillItems: SlashMenuItem[] = skillQuery === null
    ? []
    : [...skills]
      .map((skill) => ({
        skill,
        score: scoreSkill(skillQuery, skill, normalized, explicitSkillQuery !== null),
      }))
      .filter((entry) => entry.score !== null)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.skill.name.localeCompare(right.skill.name))
      .map(({ skill }) => ({
        key: `skill:${skill.name}`,
        insertText: `/skill:${skill.name} `,
        displayCmd: `/skill:${skill.name}`,
        icon: '✦',
        desc: skill.description,
        section: 'Skills',
        source: skill.source,
        kind: 'skill',
      }));

  return [...commandItems, ...skillItems];
}
