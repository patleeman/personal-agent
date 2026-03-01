import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  applyDurableMemoryChanges,
  buildDurableMemoryBlock,
  createDefaultDurableMemoryContent,
  sanitizeProfileName,
  type DurableMemoryChange,
} from './durable-memory';

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

function formatCommandFailure(command: string, args: string[], stdout: string, stderr: string): string {
  const output = stderr.trim() || stdout.trim() || 'No command output';
  return `${command} ${args.join(' ')} failed: ${output}`;
}

export default function memoryCardsExtension(pi: ExtensionAPI): void {
  const durableMemoryMaxTokens = toPositiveInt(
    process.env.PERSONAL_AGENT_DURABLE_MEMORY_MAX_TOKENS,
    DEFAULT_DURABLE_MEMORY_MAX_TOKENS,
  );

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

    if (blocks.length === 0) {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${blocks.join('\n\n')}`,
    };
  });
}
