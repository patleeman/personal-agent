import type { MemoryCard, SessionMemoryCardRequest } from './memory-types.js';

const MAX_SUBSYSTEMS = 5;
const MAX_TOPICS = 10;
const MAX_DURABLE_DECISIONS = 6;
const MAX_INVARIANTS = 5;
const MAX_PITFALLS = 5;
const MAX_OPEN_LOOPS = 5;
const MAX_ITEM_CHARS = 240;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }

  return `${value.slice(0, maxChars - 3)}...`;
}

function normalizeList(input: unknown, maxItems: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const output: string[] = [];
  const seen = new Set<string>();

  for (const value of input) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = clipText(value.replace(/\s+/g, ' ').trim(), MAX_ITEM_CHARS);
    if (normalized.length === 0) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    output.push(normalized);
    seen.add(key);

    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
}

function extractFirstJsonObject(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return JSON.parse(trimmed) as unknown;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const fencedBody = fenced[1].trim();
    if (fencedBody.startsWith('{') && fencedBody.endsWith('}')) {
      return JSON.parse(fencedBody) as unknown;
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('memory card response did not contain a JSON object');
  }

  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

export function normalizeMemoryCard(
  candidate: unknown,
  request: SessionMemoryCardRequest,
): MemoryCard {
  const parsed = isRecord(candidate) ? candidate : {};

  const supersedes = typeof parsed.supersedes === 'string'
    ? clipText(parsed.supersedes.replace(/\s+/g, ' ').trim(), MAX_ITEM_CHARS)
    : null;

  return {
    type: 'memory_card',
    session_id: request.sessionId,
    cwd: request.cwd,
    subsystems: normalizeList(parsed.subsystems, MAX_SUBSYSTEMS),
    primary_topics: normalizeList(parsed.primary_topics, MAX_TOPICS),
    durable_decisions: normalizeList(parsed.durable_decisions, MAX_DURABLE_DECISIONS),
    invariants: normalizeList(parsed.invariants, MAX_INVARIANTS),
    pitfalls: normalizeList(parsed.pitfalls, MAX_PITFALLS),
    open_loops: normalizeList(parsed.open_loops, MAX_OPEN_LOOPS),
    supersedes: supersedes && supersedes.length > 0 ? supersedes : null,
    summary_path: request.summaryRelativePath,
  };
}

export function parseAndNormalizeMemoryCard(
  rawResponse: string,
  request: SessionMemoryCardRequest,
): MemoryCard {
  const parsed = extractFirstJsonObject(rawResponse);
  return normalizeMemoryCard(parsed, request);
}

export function formatMemoryCard(card: MemoryCard): string {
  return `${JSON.stringify(card, null, 2)}\n`;
}
