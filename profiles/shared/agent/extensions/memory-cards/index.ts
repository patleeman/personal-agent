import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
  buildMemoryCandidatesBlock,
  filterHitsByTtl,
  parseQmdMemoryCardHits,
  shouldInjectMemoryCards,
  type MemoryCardHit,
} from './helpers';

const DEFAULT_COLLECTION = 'memory_cards';
const DEFAULT_TOP_K = 12;
const DEFAULT_MAX_CARDS = 3;
const DEFAULT_SCORE_THRESHOLD = 0.55;
const DEFAULT_MAX_TOKENS = 400;
const DEFAULT_TTL_DAYS = 90;

function toPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function toPositiveFloat(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function resolveStateRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveCardsDir(): string {
  const explicit = process.env.PERSONAL_AGENT_MEMORY_CARDS_DIR?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  return join(resolveStateRoot(), 'memory', 'cards');
}

function getLatestAssistantText(ctx: ExtensionContext): string {
  const branch = ctx.sessionManager.getBranch();

  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as unknown as {
      type?: string;
      message?: {
        role?: string;
        content?: unknown;
      };
    };

    if (entry.type !== 'message' || entry.message?.role !== 'assistant') {
      continue;
    }

    const content = entry.message.content;
    if (!Array.isArray(content)) {
      continue;
    }

    const text = content
      .filter((block) => typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text')
      .map((block) => (block as { text?: string }).text)
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  return '';
}

function toLocalCardPath(cardsDir: string, qmdFileUri: string): string | undefined {
  const prefix = 'qmd://memory_cards/';
  if (!qmdFileUri.startsWith(prefix)) {
    return undefined;
  }

  const relativePath = qmdFileUri.slice(prefix.length).replace(/^\/+/, '');
  if (relativePath.length === 0) {
    return undefined;
  }

  return join(cardsDir, relativePath);
}

async function queryMemoryCardHits(
  pi: ExtensionAPI,
  options: {
    query: string;
    cardsDir: string;
    collection: string;
    topK: number;
    ttlDays: number;
  },
): Promise<MemoryCardHit[]> {
  const result = await pi.exec('qmd', [
    'query',
    options.query,
    '-c',
    options.collection,
    '-n',
    String(options.topK),
    '--json',
    '--full',
  ]);

  if (result.code !== 0) {
    return [];
  }

  const hits = parseQmdMemoryCardHits(result.stdout);
  if (hits.length === 0) {
    return [];
  }

  const nowMs = Date.now();

  const ttlFiltered = filterHitsByTtl({
    hits,
    nowMs,
    ttlDays: options.ttlDays,
    getMtimeMs: (hit) => {
      const localPath = toLocalCardPath(options.cardsDir, hit.file);
      if (!localPath || !existsSync(localPath)) {
        return undefined;
      }

      try {
        return statSync(localPath).mtimeMs;
      } catch {
        return undefined;
      }
    },
  });

  return ttlFiltered.sort((a, b) => b.score - a.score);
}

export default function memoryCardsExtension(pi: ExtensionAPI): void {
  const collection = process.env.PERSONAL_AGENT_MEMORY_CARDS_COLLECTION ?? DEFAULT_COLLECTION;
  const topK = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_TOP_K, DEFAULT_TOP_K);
  const maxCards = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_MAX_CARDS, DEFAULT_MAX_CARDS);
  const maxTokens = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_MAX_TOKENS, DEFAULT_MAX_TOKENS);
  const scoreThreshold = toPositiveFloat(process.env.PERSONAL_AGENT_MEMORY_SCORE_THRESHOLD, DEFAULT_SCORE_THRESHOLD);
  const ttlDays = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_TTL_DAYS, DEFAULT_TTL_DAYS);
  const cardsDir = resolveCardsDir();

  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0) {
      return;
    }

    if (prompt.startsWith('/')) {
      return;
    }

    const latestAssistant = getLatestAssistantText(ctx);
    const query = latestAssistant.length > 0
      ? `${prompt}\n\nPrevious assistant context: ${latestAssistant}`
      : prompt;

    const hits = await queryMemoryCardHits(pi, {
      query,
      cardsDir,
      collection,
      topK,
      ttlDays,
    });

    if (hits.length === 0) {
      return;
    }

    const topScore = hits[0]?.score ?? 0;
    if (!shouldInjectMemoryCards({
      topScore,
      prompt,
      threshold: scoreThreshold,
    })) {
      return;
    }

    const block = buildMemoryCandidatesBlock({
      hits,
      cwd: ctx.cwd,
      maxCards,
      maxTokens,
    });

    if (block.length === 0) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${block}`,
    };
  });
}
