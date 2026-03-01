import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  applyDurableMemoryChanges,
  buildDurableMemoryBlock,
  createDefaultDurableMemoryContent,
  sanitizeProfileName,
  type DurableMemoryChange,
} from './durable-memory';
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
const DEFAULT_DURABLE_MEMORY_MAX_TOKENS = 350;

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

  return join(process.env.HOME ?? '/tmp', '.local', 'state', 'personal-agent');
}

function resolveCardsDir(): string {
  const explicit = process.env.PERSONAL_AGENT_MEMORY_CARDS_DIR?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  return join(resolveStateRoot(), 'memory', 'cards');
}

function resolveRepoRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  const extensionDir = dirname(fileURLToPath(import.meta.url));
  return resolve(extensionDir, '../../../../..');
}

function resolveActiveProfile(explicitProfile?: string): string {
  if (explicitProfile) {
    const sanitized = sanitizeProfileName(explicitProfile);
    if (sanitized) {
      return sanitized;
    }
  }

  const fromEnv = sanitizeProfileName(process.env.PERSONAL_AGENT_ACTIVE_PROFILE)
    ?? sanitizeProfileName(process.env.PERSONAL_AGENT_PROFILE);

  return fromEnv ?? 'shared';
}

function resolveDurableMemoryPath(repoRoot: string, profile: string): string {
  return join(repoRoot, 'profiles', profile, 'agent', 'MEMORY.md');
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

function toLocalCardPath(cardsDir: string, collection: string, qmdFileUri: string): string | undefined {
  const prefix = `qmd://${collection}/`;
  if (!qmdFileUri.startsWith(prefix)) {
    return undefined;
  }

  const relativePath = qmdFileUri.slice(prefix.length).replace(/^\/+/, '');
  if (relativePath.length === 0) {
    return undefined;
  }

  return join(cardsDir, relativePath);
}

function getDurableMemoryFile(options: {
  repoRoot: string;
  profile: string;
}): { profile: string; path: string; content: string } | undefined {
  const candidates = [options.profile];
  if (options.profile !== 'shared') {
    candidates.push('shared');
  }

  for (const profile of candidates) {
    const memoryFilePath = resolveDurableMemoryPath(options.repoRoot, profile);
    if (!existsSync(memoryFilePath)) {
      continue;
    }

    const content = readFileSync(memoryFilePath, 'utf-8');
    if (content.trim().length === 0) {
      continue;
    }

    return {
      profile,
      path: memoryFilePath,
      content,
    };
  }

  return undefined;
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
      const localPath = toLocalCardPath(options.cardsDir, options.collection, hit.file);
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

function formatCommandFailure(command: string, args: string[], stdout: string, stderr: string): string {
  const output = stderr.trim() || stdout.trim() || 'No command output';
  return `${command} ${args.join(' ')} failed: ${output}`;
}

export default function memoryCardsExtension(pi: ExtensionAPI): void {
  const collection = process.env.PERSONAL_AGENT_MEMORY_CARDS_COLLECTION ?? DEFAULT_COLLECTION;
  const topK = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_TOP_K, DEFAULT_TOP_K);
  const maxCards = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_MAX_CARDS, DEFAULT_MAX_CARDS);
  const maxTokens = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_MAX_TOKENS, DEFAULT_MAX_TOKENS);
  const scoreThreshold = toPositiveFloat(process.env.PERSONAL_AGENT_MEMORY_SCORE_THRESHOLD, DEFAULT_SCORE_THRESHOLD);
  const ttlDays = toPositiveInt(process.env.PERSONAL_AGENT_MEMORY_TTL_DAYS, DEFAULT_TTL_DAYS);
  const durableMemoryMaxTokens = toPositiveInt(
    process.env.PERSONAL_AGENT_DURABLE_MEMORY_MAX_TOKENS,
    DEFAULT_DURABLE_MEMORY_MAX_TOKENS,
  );
  const cardsDir = resolveCardsDir();

  const changeSchema = Type.Object({
    op: Type.String({ description: 'Operation: upsert | remove | replace' }),
    section: Type.String({ description: 'Section heading in MEMORY.md' }),
    value: Type.Optional(Type.String({ description: 'Fact text for upsert/remove' })),
    from: Type.Optional(Type.String({ description: 'Existing fact text for replace' })),
    to: Type.Optional(Type.String({ description: 'New fact text for replace' })),
  });

  pi.registerTool({
    name: 'memory_update',
    label: 'Durable Memory Update',
    description:
      'Update durable profile memory in profiles/<profile>/agent/MEMORY.md, then git add/commit/push when content changes.',
    parameters: Type.Object({
      profile: Type.Optional(Type.String({ description: 'Profile name (defaults to active profile)' })),
      changes: Type.Array(changeSchema, { minItems: 1 }),
      commitMessage: Type.Optional(Type.String({ description: 'Optional custom git commit message' })),
    }),
    async execute(_toolCallId, params) {
      const explicitProfile = typeof params.profile === 'string' ? params.profile : undefined;
      if (explicitProfile && !sanitizeProfileName(explicitProfile)) {
        return {
          content: [{ type: 'text', text: `Invalid profile: ${explicitProfile}` }],
          isError: true,
        };
      }

      const changes = Array.isArray(params.changes)
        ? params.changes.filter(
            (entry): entry is DurableMemoryChange =>
              typeof entry === 'object'
              && entry !== null
              && typeof (entry as { op?: unknown }).op === 'string'
              && typeof (entry as { section?: unknown }).section === 'string',
          )
        : [];

      if (changes.length === 0) {
        return {
          content: [{ type: 'text', text: 'No valid durable memory changes provided.' }],
          isError: true,
        };
      }

      const profile = resolveActiveProfile(explicitProfile);
      const repoRoot = resolveRepoRoot();
      const memoryPath = resolveDurableMemoryPath(repoRoot, profile);
      const memoryDir = dirname(memoryPath);

      mkdirSync(memoryDir, { recursive: true });

      const existingContent = existsSync(memoryPath)
        ? readFileSync(memoryPath, 'utf-8')
        : createDefaultDurableMemoryContent();

      const updateResult = applyDurableMemoryChanges({
        existingContent,
        changes,
      });

      if (updateResult.errors.length > 0 && updateResult.applied.length === 0) {
        return {
          content: [{ type: 'text', text: updateResult.errors.join('\n') }],
          isError: true,
        };
      }

      if (!updateResult.changed) {
        const warnings = updateResult.errors.length > 0
          ? `\nWarnings:\n${updateResult.errors.join('\n')}`
          : '';

        return {
          content: [{ type: 'text', text: `No durable memory changes required for ${profile}.${warnings}` }],
          details: {
            profile,
            path: memoryPath,
            changed: false,
            applied: updateResult.applied,
            warnings: updateResult.errors,
          },
        };
      }

      writeFileSync(memoryPath, updateResult.content, 'utf-8');

      const relativeMemoryPath = relative(repoRoot, memoryPath).replace(/\\/g, '/');
      const commitMessage = typeof params.commitMessage === 'string' && params.commitMessage.trim().length > 0
        ? params.commitMessage.trim()
        : `memory(${profile}): update durable memory`;

      const addResult = await pi.exec('git', ['-C', repoRoot, 'add', relativeMemoryPath]);
      if (addResult.code !== 0) {
        return {
          content: [{
            type: 'text',
            text: formatCommandFailure('git', ['-C', repoRoot, 'add', relativeMemoryPath], addResult.stdout, addResult.stderr),
          }],
          isError: true,
        };
      }

      const stagedResult = await pi.exec('git', ['-C', repoRoot, 'diff', '--cached', '--quiet', '--', relativeMemoryPath]);
      if (stagedResult.code > 1) {
        return {
          content: [{
            type: 'text',
            text: formatCommandFailure(
              'git',
              ['-C', repoRoot, 'diff', '--cached', '--quiet', '--', relativeMemoryPath],
              stagedResult.stdout,
              stagedResult.stderr,
            ),
          }],
          isError: true,
        };
      }

      if (stagedResult.code === 0) {
        return {
          content: [{ type: 'text', text: `Durable memory updated at ${relativeMemoryPath}, but nothing was staged for commit.` }],
          details: {
            profile,
            path: memoryPath,
            changed: true,
            committed: false,
            pushed: false,
            applied: updateResult.applied,
            warnings: updateResult.errors,
          },
        };
      }

      const commitResult = await pi.exec('git', ['-C', repoRoot, 'commit', '-m', commitMessage, '--', relativeMemoryPath]);
      if (commitResult.code !== 0) {
        return {
          content: [{
            type: 'text',
            text: formatCommandFailure(
              'git',
              ['-C', repoRoot, 'commit', '-m', commitMessage, '--', relativeMemoryPath],
              commitResult.stdout,
              commitResult.stderr,
            ),
          }],
          isError: true,
        };
      }

      const pushResult = await pi.exec('git', ['-C', repoRoot, 'push']);
      if (pushResult.code !== 0) {
        return {
          content: [{
            type: 'text',
            text: `${formatCommandFailure('git', ['-C', repoRoot, 'push'], pushResult.stdout, pushResult.stderr)}\nDurable memory was committed locally.`,
          }],
          isError: true,
          details: {
            profile,
            path: memoryPath,
            changed: true,
            committed: true,
            pushed: false,
            applied: updateResult.applied,
            warnings: updateResult.errors,
          },
        };
      }

      const warnings = updateResult.errors.length > 0
        ? `\nWarnings:\n${updateResult.errors.join('\n')}`
        : '';

      return {
        content: [{
          type: 'text',
          text: `Updated durable memory at ${relativeMemoryPath}.\nCommitted and pushed.${warnings}`,
        }],
        details: {
          profile,
          path: memoryPath,
          changed: true,
          committed: true,
          pushed: true,
          applied: updateResult.applied,
          warnings: updateResult.errors,
        },
      };
    },
  });

  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0) {
      return;
    }

    if (prompt.startsWith('/')) {
      return;
    }

    const blocks: string[] = [];

    const repoRoot = resolveRepoRoot();
    const activeProfile = resolveActiveProfile();
    const durableMemory = getDurableMemoryFile({
      repoRoot,
      profile: activeProfile,
    });

    if (durableMemory) {
      const durableBlock = buildDurableMemoryBlock({
        profile: durableMemory.profile,
        cwd: ctx.cwd,
        memoryFilePath: durableMemory.path,
        memoryFileContent: durableMemory.content,
        maxTokens: durableMemoryMaxTokens,
      });

      if (durableBlock.length > 0) {
        blocks.push(durableBlock);
      }
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

    if (hits.length > 0) {
      const topScore = hits[0]?.score ?? 0;
      if (shouldInjectMemoryCards({
        topScore,
        prompt,
        threshold: scoreThreshold,
      })) {
        const memoryBlock = buildMemoryCandidatesBlock({
          hits,
          cwd: ctx.cwd,
          maxCards,
          maxTokens,
        });

        if (memoryBlock.length > 0) {
          blocks.push(memoryBlock);
        }
      }
    }

    if (blocks.length === 0) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${blocks.join('\n\n')}`,
    };
  });
}
