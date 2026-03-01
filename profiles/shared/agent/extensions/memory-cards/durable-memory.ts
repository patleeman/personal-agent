import { relative } from 'node:path';
import { estimateTokens } from './helpers';

const DEFAULT_SECTIONS = ['User', 'Preferences', 'Environment', 'Constraints', 'Do Not Store'] as const;
const DEFAULT_DO_NOT_STORE_FACTS = [
  'Secrets, credentials, API keys, tokens',
  'Session-only or temporary task notes',
];

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface DurableMemoryChange {
  op: string;
  section: string;
  value?: string;
  from?: string;
  to?: string;
}

interface DurableMemoryDocument {
  sections: Map<string, string[]>;
  extraSectionOrder: string[];
}

function normalizeFact(raw: string | undefined): string {
  if (typeof raw !== 'string') {
    return '';
  }

  return raw.replace(/\s+/g, ' ').trim();
}

function normalizeSectionName(raw: string | undefined): string {
  if (typeof raw !== 'string') {
    return '';
  }

  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return '';
  }

  for (const section of DEFAULT_SECTIONS) {
    if (section.toLowerCase() === normalized.toLowerCase()) {
      return section;
    }
  }

  return normalized;
}

function createBaseSectionMap(): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  for (const section of DEFAULT_SECTIONS) {
    sections.set(section, []);
  }
  return sections;
}

function containsFact(facts: string[], fact: string): boolean {
  const target = fact.toLowerCase();
  return facts.some((entry) => entry.toLowerCase() === target);
}

function addFact(facts: string[], fact: string): boolean {
  if (containsFact(facts, fact)) {
    return false;
  }

  facts.push(fact);
  return true;
}

function removeFact(facts: string[], fact: string): boolean {
  const target = fact.toLowerCase();
  const before = facts.length;
  const filtered = facts.filter((entry) => entry.toLowerCase() !== target);

  if (filtered.length === before) {
    return false;
  }

  facts.splice(0, facts.length, ...filtered);
  return true;
}

function ensureDoNotStoreDefaults(sections: Map<string, string[]>): void {
  const doNotStore = sections.get('Do Not Store') ?? [];

  for (const fact of DEFAULT_DO_NOT_STORE_FACTS) {
    addFact(doNotStore, fact);
  }

  sections.set('Do Not Store', doNotStore);
}

function parseDurableMemory(content: string): DurableMemoryDocument {
  const sections = createBaseSectionMap();
  const extraSectionOrder: string[] = [];
  let currentSection = '';

  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      const section = normalizeSectionName(headingMatch[1]);
      currentSection = section;
      if (!section) {
        continue;
      }

      if (!sections.has(section)) {
        sections.set(section, []);
        extraSectionOrder.push(section);
      }
      continue;
    }

    const bulletMatch = line.match(/^\s*-\s+(.+)$/);
    if (!bulletMatch || !currentSection) {
      continue;
    }

    const fact = normalizeFact(bulletMatch[1]);
    if (!fact) {
      continue;
    }

    const facts = sections.get(currentSection) ?? [];
    addFact(facts, fact);
    sections.set(currentSection, facts);
  }

  ensureDoNotStoreDefaults(sections);

  return {
    sections,
    extraSectionOrder,
  };
}

function buildSectionOrder(extraSectionOrder: string[]): string[] {
  const order = [...DEFAULT_SECTIONS];

  for (const section of extraSectionOrder) {
    if (order.includes(section)) {
      continue;
    }

    order.push(section);
  }

  return order;
}

function renderDurableMemoryDocument(document: DurableMemoryDocument): string {
  const lines: string[] = ['# Durable Memory', ''];

  for (const section of buildSectionOrder(document.extraSectionOrder)) {
    lines.push(`## ${section}`);

    const facts = document.sections.get(section) ?? [];
    for (const fact of facts) {
      lines.push(`- ${fact}`);
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function normalizeForDiff(content: string): string {
  return content.trimEnd().replace(/\r\n/g, '\n');
}

export function createDefaultDurableMemoryContent(): string {
  return renderDurableMemoryDocument(parseDurableMemory(''));
}

export function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function applyDurableMemoryChanges(options: {
  existingContent: string;
  changes: DurableMemoryChange[];
}): {
  content: string;
  changed: boolean;
  applied: string[];
  errors: string[];
} {
  const document = parseDurableMemory(options.existingContent);
  const applied: string[] = [];
  const errors: string[] = [];

  for (const rawChange of options.changes) {
    const section = normalizeSectionName(rawChange.section);
    if (!section) {
      errors.push('Change skipped: section is required.');
      continue;
    }

    if (!document.sections.has(section)) {
      document.sections.set(section, []);
      document.extraSectionOrder.push(section);
    }

    const facts = document.sections.get(section) ?? [];
    const op = rawChange.op.trim().toLowerCase();

    if (op === 'upsert') {
      const value = normalizeFact(rawChange.value);
      if (!value) {
        errors.push(`Change skipped: upsert requires value (section: ${section}).`);
        continue;
      }

      if (addFact(facts, value)) {
        applied.push(`upsert ${section}: ${value}`);
      }
      continue;
    }

    if (op === 'remove') {
      const value = normalizeFact(rawChange.value);
      if (!value) {
        errors.push(`Change skipped: remove requires value (section: ${section}).`);
        continue;
      }

      if (removeFact(facts, value)) {
        applied.push(`remove ${section}: ${value}`);
      }
      continue;
    }

    if (op === 'replace') {
      const from = normalizeFact(rawChange.from);
      const to = normalizeFact(rawChange.to);
      if (!from || !to) {
        errors.push(`Change skipped: replace requires from and to (section: ${section}).`);
        continue;
      }

      const removed = removeFact(facts, from);
      const added = addFact(facts, to);
      if (removed || added) {
        applied.push(`replace ${section}: ${from} -> ${to}`);
      }
      continue;
    }

    errors.push(`Change skipped: unsupported op "${rawChange.op}".`);
  }

  ensureDoNotStoreDefaults(document.sections);

  const nextContent = renderDurableMemoryDocument(document);

  return {
    content: nextContent,
    changed: normalizeForDiff(options.existingContent) !== normalizeForDiff(nextContent),
    applied,
    errors,
  };
}

function trimByTokenLimit(text: string, maxTokens: number): { content: string; truncated: boolean } {
  const normalizedMax = Math.max(1, maxTokens);
  const lines = text.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const candidate = output.length === 0 ? line : `${output.join('\n')}\n${line}`;
    if (estimateTokens(candidate) > normalizedMax) {
      break;
    }

    output.push(line);
  }

  if (output.length === 0) {
    return {
      content: lines[0] ?? '',
      truncated: lines.length > 1,
    };
  }

  return {
    content: output.join('\n').trimEnd(),
    truncated: output.length < lines.length,
  };
}

export function buildDurableMemoryBlock(options: {
  profile: string;
  cwd: string;
  memoryFilePath: string;
  memoryFileContent: string;
  maxTokens: number;
}): string {
  if (options.maxTokens <= 0) {
    return '';
  }

  const trimmed = options.memoryFileContent.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const trimmedResult = trimByTokenLimit(trimmed, options.maxTokens);
  const displayedPath = relative(options.cwd, options.memoryFilePath) || options.memoryFilePath;
  const lines = [
    `DURABLE_MEMORY (profile=${options.profile}, path=${displayedPath})`,
    trimmedResult.content,
  ];

  if (trimmedResult.truncated) {
    lines.push(`[Durable memory truncated to ~${options.maxTokens} tokens.]`);
  }

  lines.push(
    'If the user gives newer conflicting facts, follow the user and call memory_update to keep this file current.',
  );

  return lines.join('\n');
}
