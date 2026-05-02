import type { MemoryAgentsItem, MemoryData, MemoryDocItem, MemorySkillItem } from './types';
import { timeAgo } from './utils';

export type MemoryLayer = 'overview' | 'identity' | 'capabilities' | 'knowledge';

interface MarkdownSection {
  heading: string;
  lines: string[];
}

export interface IdentitySummary {
  role: string;
  behaviorRules: string[];
  boundaries: string[];
  ruleCount: number;
  primaryItem: MemoryAgentsItem | null;
}

export interface CapabilityCardModel {
  title: string;
  whenToUse: string;
  sourceLabel: 'Shared' | 'Custom';
  sourceTone: 'teal' | 'accent';
  usageLabel: string;
  recentSessionCount: number;
  usedInLastSession: boolean;
  lastUsedAt: string | null;
  item: MemorySkillItem;
}

export interface KnowledgeCardModel {
  title: string;
  summary: string;
  category: 'patterns' | 'references';
  usageLabel: string;
  recentSessionCount: number;
  usedInLastSession: boolean;
  lastUsedAt: string | null;
  tags: string[];
  item: MemoryDocItem;
}

export interface KnowledgeSections {
  recent: KnowledgeCardModel[];
  patterns: KnowledgeCardModel[];
  references: KnowledgeCardModel[];
}

export interface MemoryPageSummary {
  role: string;
  identityRuleCount: number;
  capabilityCount: number;
  recentlyUsedCapabilities: number;
  knowledgeCount: number;
  recentlyUsedKnowledge: number;
}

const SECTION_PRIORITY = [
  'role',
  'operating policy',
  'project-specific instructions',
  'repo instructions',
  'working with the user',
  'memory handling rules',
  'durable memory policy',
  'core model direction',
  'profile memory convention',
] as const;

const IGNORE_SECTION_KEYWORDS = [
  'durable user context',
  'memory use',
  'memory write targets',
] as const;

const ACRONYM_MAP: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  ci: 'CI',
  cli: 'CLI',
  dd: 'Datadog',
  e2e: 'E2E',
  gitlab: 'GitLab',
  jira: 'Jira',
  mcp: 'MCP',
  odp: 'ODP',
  pa: 'PA',
  pr: 'PR',
  react: 'React',
  sdk: 'SDK',
  sql: 'SQL',
  tdd: 'TDD',
  tui: 'TUI',
  ui: 'UI',
  ux: 'UX',
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function titleCaseToken(token: string): string {
  const normalized = token.toLowerCase();
  if (ACRONYM_MAP[normalized]) {
    return ACRONYM_MAP[normalized];
  }

  switch (normalized) {
    case 'oncall':
      return 'On-call';
    case 'workspaces':
      return 'Workspaces';
    case 'atlassian':
      return 'Atlassian';
    case 'lambo':
      return 'Lambo';
    case 'pup':
      return 'Pup';
    default:
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
}

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitMarkdownSections(content: string | undefined): MarkdownSection[] {
  if (!content) {
    return [];
  }

  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { heading: '', lines: [] };

  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const headingMatch = rawLine.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      if (current.heading || current.lines.length > 0) {
        sections.push(current);
      }
      current = { heading: cleanInlineMarkdown(headingMatch[1] ?? ''), lines: [] };
      continue;
    }

    current.lines.push(rawLine);
  }

  if (current.heading || current.lines.length > 0) {
    sections.push(current);
  }

  return sections;
}

function extractBullets(lines: string[]): string[] {
  return lines
    .map((line) => line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1] ?? null)
    .filter((value): value is string => value !== null)
    .map((value) => cleanInlineMarkdown(value))
    .filter(Boolean);
}

function extractParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.length > 0) {
        paragraphs.push(cleanInlineMarkdown(current.join(' ')));
        current = [];
      }
      continue;
    }

    if (/^\s*(?:[-*]|\d+\.)\s+/.test(rawLine)) {
      continue;
    }

    current.push(line);
  }

  if (current.length > 0) {
    paragraphs.push(cleanInlineMarkdown(current.join(' ')));
  }

  return paragraphs.filter(Boolean);
}

function sectionMatches(heading: string, keyword: string): boolean {
  return normalizeText(heading).includes(keyword);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(item);
  }

  return result;
}

function orderedAgents(items: MemoryAgentsItem[], profileName: string): MemoryAgentsItem[] {
  return [...items]
    .filter((item) => item.exists && item.content)
    .sort((left, right) => {
      const leftPriority = left.source === profileName ? 0 : 1;
      const rightPriority = right.source === profileName ? 0 : 1;
      return leftPriority - rightPriority || left.source.localeCompare(right.source);
    });
}

function normalizeRoleText(value: string): string {
  const cleaned = cleanInlineMarkdown(value)
    .replace(/^you are\s+/i, '')
    .replace(/^role\s*:\s*/i, '')
    .replace(/\.$/, '')
    .trim();

  if (!cleaned) {
    return 'Personal agent';
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function extractRole(items: MemoryAgentsItem[], profileName: string): string {
  for (const item of orderedAgents(items, profileName)) {
    const sections = splitMarkdownSections(item.content);
    const roleSection = sections.find((section) => sectionMatches(section.heading, 'role'));
    if (!roleSection) {
      continue;
    }

    const bullets = extractBullets(roleSection.lines);
    if (bullets[0]) {
      return normalizeRoleText(bullets[0]);
    }

    const paragraphs = extractParagraphs(roleSection.lines);
    if (paragraphs[0]) {
      return normalizeRoleText(paragraphs[0]);
    }
  }

  return `${profileName.charAt(0).toUpperCase() + profileName.slice(1)} agent`;
}

function extractBehaviorRules(items: MemoryAgentsItem[], profileName: string): string[] {
  const rules: string[] = [];
  const agents = orderedAgents(items, profileName);

  for (const keyword of SECTION_PRIORITY) {
    for (const item of agents) {
      const sections = splitMarkdownSections(item.content);
      for (const section of sections) {
        const heading = normalizeText(section.heading);
        if (IGNORE_SECTION_KEYWORDS.some((ignored) => heading.includes(ignored))) {
          continue;
        }
        if (!heading.includes(keyword)) {
          continue;
        }
        rules.push(...extractBullets(section.lines));
      }
    }
  }

  if (rules.length < 8) {
    for (const item of agents) {
      const sections = splitMarkdownSections(item.content);
      for (const section of sections) {
        const heading = normalizeText(section.heading);
        if (IGNORE_SECTION_KEYWORDS.some((ignored) => heading.includes(ignored))) {
          continue;
        }
        rules.push(...extractBullets(section.lines));
      }
    }
  }

  return dedupe(rules);
}

function extractBoundaries(rules: string[]): string[] {
  const boundaryRules = rules.filter((rule) => /(do not|don't|never|only|must|prefer|before|without|keep|always|correct implementations)/i.test(rule));
  return boundaryRules.slice(0, 6);
}

function tokenizeHumanTitle(value: string): string[] {
  return value.split('-').map((part) => titleCaseToken(part));
}

export function humanizeSkillName(name: string): string {
  if (name.startsWith('workflow-')) {
    return `${tokenizeHumanTitle(name.slice('workflow-'.length)).join(' ')}`;
  }

  if (name.startsWith('best-practices-')) {
    return `${tokenizeHumanTitle(name.slice('best-practices-'.length)).join(' ')} Best Practices`;
  }

  if (name.startsWith('tool-')) {
    return tokenizeHumanTitle(name.slice('tool-'.length)).join(' ');
  }

  if (name.startsWith('pa-')) {
    return tokenizeHumanTitle(name.slice('pa-'.length)).join(' ');
  }

  if (name === 'subagent') {
    return 'Subagent';
  }

  if (name.startsWith('subagent-')) {
    return `${tokenizeHumanTitle(name.slice('subagent-'.length)).join(' ')} Subagent`;
  }

  if (name.startsWith('dd-')) {
    return tokenizeHumanTitle(name.slice('dd-'.length)).join(' ');
  }

  return tokenizeHumanTitle(name).join(' ');
}

function matchesQuery(values: Array<string | undefined>, query: string): boolean {
  const normalized = normalizeText(query);
  if (!normalized) {
    return true;
  }

  return values.some((value) => value?.toLowerCase().includes(normalized));
}

export function formatUsageLabel(
  recentSessionCount: number | undefined,
  lastUsedAt: string | null | undefined,
  usedInLastSession: boolean | undefined,
  inactiveLabel: string,
): string {
  if (usedInLastSession) {
    return 'Triggered in last session';
  }

  if ((recentSessionCount ?? 0) >= 2) {
    return `Used ${recentSessionCount} times this week`;
  }

  if ((recentSessionCount ?? 0) === 1) {
    return lastUsedAt ? `Used ${timeAgo(lastUsedAt)}` : 'Used this week';
  }

  if (lastUsedAt) {
    return `Used ${timeAgo(lastUsedAt)}`;
  }

  return inactiveLabel;
}

function sortByRecentUse<T extends { title: string; recentSessionCount: number; usedInLastSession: boolean; lastUsedAt: string | null }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftLast = left.lastUsedAt ? new Date(left.lastUsedAt).getTime() : 0;
    const rightLast = right.lastUsedAt ? new Date(right.lastUsedAt).getTime() : 0;
    return Number(right.usedInLastSession) - Number(left.usedInLastSession)
      || right.recentSessionCount - left.recentSessionCount
      || rightLast - leftLast
      || left.title.localeCompare(right.title);
  });
}

function classifyKnowledgeItem(item: MemoryDocItem): 'patterns' | 'references' {
  const haystack = normalizeText([
    item.type,
    item.title,
    item.summary,
    ...item.tags,
  ].filter(Boolean).join(' '));

  if (/(pattern|heuristic|lesson|playbook|checklist|decision|architecture)/.test(haystack)) {
    return 'patterns';
  }

  return 'references';
}

export function buildIdentitySummary(data: MemoryData): IdentitySummary {
  const rules = extractBehaviorRules(data.agentsMd, data.profile);
  const primaryItem = data.agentsMd.find((item) => item.exists && item.source === data.profile)
    ?? data.agentsMd.find((item) => item.exists)
    ?? null;

  return {
    role: extractRole(data.agentsMd, data.profile),
    behaviorRules: rules.slice(0, 8),
    boundaries: extractBoundaries(rules),
    ruleCount: rules.length,
    primaryItem,
  };
}

export function buildCapabilityCards(data: MemoryData, query = ''): CapabilityCardModel[] {
  const items = data.skills.map((item) => ({
    title: humanizeSkillName(item.name),
    whenToUse: item.description,
    sourceLabel: item.source === 'shared' ? 'Shared' as const : 'Custom' as const,
    sourceTone: item.source === 'shared' ? 'teal' as const : 'accent' as const,
    usageLabel: formatUsageLabel(item.recentSessionCount, item.lastUsedAt, item.usedInLastSession, 'Not used recently'),
    recentSessionCount: item.recentSessionCount ?? 0,
    usedInLastSession: item.usedInLastSession ?? false,
    lastUsedAt: item.lastUsedAt ?? null,
    item,
  }));

  return sortByRecentUse(items).filter((item) => matchesQuery([
    item.title,
    item.whenToUse,
    item.sourceLabel,
    item.item.name,
  ], query));
}

export function buildKnowledgeSections(data: MemoryData, query = ''): KnowledgeSections {
  const items = data.memoryDocs.map((item) => ({
    title: item.title,
    summary: item.summary,
    category: classifyKnowledgeItem(item),
    usageLabel: formatUsageLabel(item.recentSessionCount, item.lastUsedAt, item.usedInLastSession, 'Not used recently'),
    recentSessionCount: item.recentSessionCount ?? 0,
    usedInLastSession: item.usedInLastSession ?? false,
    lastUsedAt: item.lastUsedAt ?? null,
    tags: item.tags,
    item,
  } satisfies KnowledgeCardModel)).filter((item) => matchesQuery([
    item.title,
    item.summary,
    item.category === 'patterns' ? 'learned patterns' : 'reference materials',
    ...item.tags,
  ], query));

  const sorted = sortByRecentUse(items);
  return {
    recent: sorted.filter((item) => item.lastUsedAt).slice(0, 5),
    patterns: sorted.filter((item) => item.category === 'patterns'),
    references: sorted.filter((item) => item.category === 'references'),
  };
}

export function buildMemoryPageSummary(data: MemoryData): MemoryPageSummary {
  const identity = buildIdentitySummary(data);
  const capabilities = buildCapabilityCards(data);
  const knowledge = buildKnowledgeSections(data);

  return {
    role: identity.role,
    identityRuleCount: identity.ruleCount,
    capabilityCount: capabilities.length,
    recentlyUsedCapabilities: capabilities.filter((item) => item.recentSessionCount > 0 || item.usedInLastSession).length,
    knowledgeCount: data.memoryDocs.length,
    recentlyUsedKnowledge: knowledge.recent.length,
  };
}
