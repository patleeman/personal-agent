export interface MemoryCard {
  type: 'memory_card';
  session_id: string;
  cwd: string;
  subsystems: string[];
  primary_topics: string[];
  durable_decisions: string[];
  invariants: string[];
  pitfalls: string[];
  open_loops: string[];
  supersedes: string | null;
  summary_path: string;
}

export interface MemoryCardHit {
  score: number;
  file: string;
  card: MemoryCard;
}

interface QmdJsonResultRow {
  score?: unknown;
  file?: unknown;
  body?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const normalized = item.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
      continue;
    }

    output.push(normalized);
    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  return Math.ceil(trimmed.length / 4);
}

export function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  const jsonStart = trimmed.indexOf('[');
  const jsonEnd = trimmed.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeMemoryCard(candidate: unknown): MemoryCard | undefined {
  if (!isRecord(candidate)) {
    return undefined;
  }

  const sessionId = typeof candidate.session_id === 'string' ? candidate.session_id.trim() : '';
  const cwd = typeof candidate.cwd === 'string' ? candidate.cwd.trim() : '';
  const summaryPath = typeof candidate.summary_path === 'string' ? candidate.summary_path.trim() : '';

  if (sessionId.length === 0 || cwd.length === 0 || summaryPath.length === 0) {
    return undefined;
  }

  const supersedes = typeof candidate.supersedes === 'string'
    ? candidate.supersedes.trim() || null
    : null;

  return {
    type: 'memory_card',
    session_id: sessionId,
    cwd,
    subsystems: toStringArray(candidate.subsystems, 5),
    primary_topics: toStringArray(candidate.primary_topics, 10),
    durable_decisions: toStringArray(candidate.durable_decisions, 6),
    invariants: toStringArray(candidate.invariants, 5),
    pitfalls: toStringArray(candidate.pitfalls, 5),
    open_loops: toStringArray(candidate.open_loops, 5),
    supersedes,
    summary_path: summaryPath,
  };
}

export function parseQmdMemoryCardHits(rawOutput: string): MemoryCardHit[] {
  const rows = extractJsonArray(rawOutput);
  const hits: MemoryCardHit[] = [];

  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const typedRow = row as QmdJsonResultRow;
    if (typeof typedRow.body !== 'string' || typeof typedRow.file !== 'string') {
      continue;
    }

    let parsedCardRaw: unknown;
    try {
      parsedCardRaw = JSON.parse(typedRow.body) as unknown;
    } catch {
      continue;
    }

    const card = normalizeMemoryCard(parsedCardRaw);
    if (!card) {
      continue;
    }

    const score = typeof typedRow.score === 'number' && Number.isFinite(typedRow.score)
      ? typedRow.score
      : 0;

    hits.push({
      score,
      file: typedRow.file,
      card,
    });
  }

  return hits;
}

export function isRecallIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    'remember',
    'recall',
    'previous',
    'last time',
    'continue',
    'follow up',
    'follow-up',
    'regression',
    'debug',
    'again',
    'what did',
  ].some((needle) => normalized.includes(needle));
}

export function shouldInjectMemoryCards(options: {
  topScore: number;
  prompt: string;
  threshold: number;
}): boolean {
  if (options.topScore >= options.threshold) {
    return true;
  }

  return isRecallIntent(options.prompt);
}

export function filterHitsByTtl(options: {
  hits: MemoryCardHit[];
  nowMs: number;
  ttlDays: number;
  getMtimeMs: (hit: MemoryCardHit) => number | undefined;
}): MemoryCardHit[] {
  if (options.ttlDays <= 0) {
    return [];
  }

  const cutoffMs = options.nowMs - options.ttlDays * 24 * 60 * 60 * 1000;

  return options.hits.filter((hit) => {
    const mtimeMs = options.getMtimeMs(hit);
    if (typeof mtimeMs !== 'number' || !Number.isFinite(mtimeMs)) {
      return false;
    }

    return mtimeMs >= cutoffMs;
  });
}

function pickSignalBullets(card: MemoryCard, maxBullets: number): string[] {
  const merged: string[] = [];

  const append = (values: string[]) => {
    for (const value of values) {
      if (merged.includes(value)) {
        continue;
      }

      merged.push(value);
      if (merged.length >= maxBullets) {
        return;
      }
    }
  };

  append(card.durable_decisions);
  append(card.invariants);
  append(card.pitfalls);
  append(card.open_loops);

  return merged.slice(0, maxBullets);
}

export function buildMemoryCandidatesBlock(options: {
  hits: MemoryCardHit[];
  cwd: string;
  maxCards: number;
  maxTokens: number;
}): string {
  if (options.hits.length === 0 || options.maxCards <= 0 || options.maxTokens <= 0) {
    return '';
  }

  const deduped: MemoryCardHit[] = [];
  const seenSessions = new Set<string>();

  for (const hit of options.hits) {
    if (seenSessions.has(hit.card.session_id)) {
      continue;
    }

    deduped.push(hit);
    seenSessions.add(hit.card.session_id);

    if (deduped.length >= options.maxCards) {
      break;
    }
  }

  const header = `MEMORY_CANDIDATES (scope=global, cwd=${options.cwd})`;
  const lines: string[] = [header];
  let totalText = `${header}\n`;

  for (const hit of deduped) {
    const card = hit.card;
    const cardLines: string[] = [
      `- session_id=${card.session_id} score=${hit.score.toFixed(2)} summary_path=${card.summary_path}`,
    ];

    const signals = pickSignalBullets(card, 3);
    for (const signal of signals) {
      cardLines.push(`  - ${signal}`);
    }

    if (card.primary_topics.length > 0) {
      cardLines.push(`  - topics: ${card.primary_topics.slice(0, 6).join(', ')}`);
    }

    const chunk = `${cardLines.join('\n')}\n`;
    if (estimateTokens(totalText + chunk) > options.maxTokens) {
      break;
    }

    lines.push(...cardLines);
    totalText += chunk;
  }

  if (lines.length === 1) {
    return '';
  }

  lines.push('Use summary_path with read/memory-open if deeper context is needed.');
  return lines.join('\n');
}
