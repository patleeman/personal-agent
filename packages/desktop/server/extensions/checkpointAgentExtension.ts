import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  type ConversationCommitCheckpointFile,
  type ConversationCommitCheckpointFileStatus,
  getConversationCommitCheckpoint,
  listConversationCommitCheckpoints,
  saveConversationCommitCheckpoint,
} from '@personal-agent/core';
import { Type } from '@sinclair/typebox';

import { invalidateAppTopics } from '../shared/appEvents.js';

const CHECKPOINT_ACTION_VALUES = ['save', 'get', 'list'] as const;
type CheckpointAction = (typeof CHECKPOINT_ACTION_VALUES)[number];

const CheckpointToolParams = Type.Object({
  action: Type.Unsafe<CheckpointAction>({
    type: 'string',
    enum: ['save', 'get', 'list'],
    description:
      'Required. Action to perform: save (create a commit checkpoint), get (retrieve a saved checkpoint), or list (show all checkpoints).',
  }),
  checkpointId: Type.Optional(Type.String({ description: 'Stable checkpoint id. Defaults to the created commit SHA.' })),
  message: Type.Optional(Type.String({ description: 'Commit message for the checkpoint. Required when action=save.' })),
  paths: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), {
      description: 'Targeted file or directory paths to include in the checkpoint commit. Required when action=save.',
    }),
  ),
});

interface ParsedCommitMetadata {
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function readPathInputs(cwd: string, values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('paths are required.');
  }

  const seen = new Set<string>();
  const normalizedPaths: string[] = [];

  for (const rawValue of values) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === '.' || trimmed === './') {
      continue;
    }

    const relativePath = isAbsolute(trimmed) ? relative(cwd, resolve(trimmed)) : trimmed.replace(/^\.\//, '');
    const normalized = relativePath.replace(/\\/g, '/').trim();

    if (!normalized || normalized.startsWith('..')) {
      throw new Error(`Invalid checkpoint path: ${rawValue}`);
    }

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedPaths.push(normalized);
  }

  if (normalizedPaths.length === 0) {
    throw new Error('paths are required.');
  }

  return normalizedPaths;
}

function runGit(cwd: string, args: string[], options: { allowEmptyStdout?: boolean } = {}): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = `${result.stderr ?? ''}`.trim();
    const stdout = `${result.stdout ?? ''}`.trim();
    const details = stderr || stdout;
    const summary = details ? `git ${args.join(' ')}:\n${details}` : `git ${args.join(' ')} failed with status ${result.status}`;
    throw new Error(summary);
  }

  const stdout = `${result.stdout ?? ''}`;
  if (!options.allowEmptyStdout && stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} returned no output.`);
  }

  return stdout;
}

function parseCommitMetadata(raw: string): ParsedCommitMetadata {
  const [commitSha = '', shortSha = '', subject = '', body = '', authorName = '', authorEmail = '', committedAt = ''] = raw.split('\u0000');

  return {
    commitSha: readRequiredString(commitSha, 'commitSha'),
    shortSha: readRequiredString(shortSha, 'shortSha'),
    subject: readRequiredString(subject, 'subject'),
    ...(body.trim().length > 0 ? { body: body.trim() } : {}),
    authorName: readRequiredString(authorName, 'authorName'),
    ...(authorEmail.trim().length > 0 ? { authorEmail: authorEmail.trim() } : {}),
    committedAt: readRequiredString(committedAt, 'committedAt'),
  };
}

function unquoteGitPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed;
}

function stripGitDiffPrefix(value: string, prefix: 'a/' | 'b/'): string {
  const unquoted = unquoteGitPath(value);
  if (unquoted === '/dev/null') {
    return unquoted;
  }

  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

function parseDiffSections(rawPatch: string): ConversationCommitCheckpointFile[] {
  const normalized = rawPatch.replace(/\r\n/g, '\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of normalized.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) {
        sections.push(current.join('\n').trimEnd());
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    sections.push(current.join('\n').trimEnd());
  }

  return sections.map((section) => {
    const lines = section.split('\n');
    const header = lines[0] ?? '';
    const match = header.match(/^diff --git (.+) (.+)$/);
    if (!match) {
      throw new Error('Could not parse git diff header for checkpoint review.');
    }

    const originalPath = stripGitDiffPrefix(match[1] ?? '', 'a/');
    const nextPath = stripGitDiffPrefix(match[2] ?? '', 'b/');
    let path = nextPath === '/dev/null' ? originalPath : nextPath;
    let previousPath: string | undefined;
    let status: ConversationCommitCheckpointFileStatus =
      originalPath === '/dev/null' ? 'added' : nextPath === '/dev/null' ? 'deleted' : 'modified';
    let additions = 0;
    let deletions = 0;

    for (const line of lines.slice(1)) {
      if (line.startsWith('new file mode ')) {
        status = 'added';
        path = nextPath;
        continue;
      }
      if (line.startsWith('deleted file mode ')) {
        status = 'deleted';
        path = originalPath;
        continue;
      }
      if (line.startsWith('rename from ')) {
        status = 'renamed';
        previousPath = line.slice('rename from '.length).trim();
        continue;
      }
      if (line.startsWith('rename to ')) {
        status = 'renamed';
        path = line.slice('rename to '.length).trim();
        continue;
      }
      if (line.startsWith('copy from ')) {
        status = 'copied';
        previousPath = line.slice('copy from '.length).trim();
        continue;
      }
      if (line.startsWith('copy to ')) {
        status = 'copied';
        path = line.slice('copy to '.length).trim();
        continue;
      }
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions += 1;
        continue;
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        deletions += 1;
      }
    }

    return {
      path: path.replace(/\\/g, '/'),
      ...(previousPath ? { previousPath: previousPath.replace(/\\/g, '/') } : {}),
      status,
      additions,
      deletions,
      patch: `${section}\n`,
    } satisfies ConversationCommitCheckpointFile;
  });
}

function formatCheckpointList(conversationId: string, checkpoints: ReturnType<typeof listConversationCommitCheckpoints>): string {
  if (checkpoints.length === 0) {
    return `No commit checkpoints saved for conversation ${conversationId}.`;
  }

  return [
    `Commit checkpoints for conversation ${conversationId}:`,
    ...checkpoints.map(
      (checkpoint) =>
        `- ${checkpoint.shortSha} ${checkpoint.subject} (${checkpoint.fileCount} files, +${checkpoint.linesAdded} -${checkpoint.linesDeleted})`,
    ),
  ].join('\n');
}

function formatCheckpoint(record: NonNullable<ReturnType<typeof getConversationCommitCheckpoint>>): string {
  return [
    `${record.shortSha} ${record.subject}`,
    `Commit: ${record.commitSha}`,
    `Author: ${record.authorName}${record.authorEmail ? ` <${record.authorEmail}>` : ''}`,
    `Committed: ${record.committedAt}`,
    `Files: ${record.fileCount} (+${record.linesAdded} -${record.linesDeleted})`,
    '',
    ...record.files.map((file) => `${file.status} ${file.path} (+${file.additions} -${file.deletions})`),
  ].join('\n');
}

function createCheckpointCommit(options: { cwd: string; message: string; paths: string[] }): {
  metadata: ParsedCommitMetadata;
  files: ConversationCommitCheckpointFile[];
  rawPatch: string;
} {
  runGit(options.cwd, ['rev-parse', '--show-toplevel']);
  runGit(options.cwd, ['add', '--all', '--', ...options.paths], { allowEmptyStdout: true });

  const stagedDiff = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...options.paths], {
    cwd: options.cwd,
    encoding: 'utf-8',
  });
  if (stagedDiff.error) {
    throw stagedDiff.error;
  }
  if (stagedDiff.status === 0) {
    throw new Error('No staged changes were found for the requested checkpoint paths.');
  }
  if (stagedDiff.status !== 1) {
    throw new Error(`${stagedDiff.stderr ?? stagedDiff.stdout ?? 'Could not inspect staged changes.'}`.trim());
  }

  runGit(options.cwd, ['commit', '--only', '-m', options.message, '--', ...options.paths], { allowEmptyStdout: true });
  const commitSha = runGit(options.cwd, ['rev-parse', 'HEAD']).trim();
  const metadata = parseCommitMetadata(
    runGit(options.cwd, ['show', '-s', `--format=%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%cI`, commitSha]),
  );
  const rawPatch = runGit(
    options.cwd,
    ['show', '--format=', '--patch', '--find-renames', '--find-copies', '--no-color', '--unified=3', commitSha],
    { allowEmptyStdout: true },
  );
  const files = parseDiffSections(rawPatch);

  return {
    metadata,
    files,
    rawPatch,
  };
}

export function createCheckpointAgentExtension(options: {
  stateRoot?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'checkpoint',
      label: 'Checkpoint',
      description:
        'Create, get, and list targeted git commit checkpoints for the current conversation. Use action=save to create a checkpoint, action=get to retrieve one, or action=list to see all saved checkpoints.',
      promptSnippet: 'Create, retrieve, or list targeted git commit checkpoints tied to the conversation.',
      promptGuidelines: [
        'Set action="save" with explicit paths and a concise commit message to create a checkpoint. Do not checkpoint unrelated files.',
        'Set action="get" with a checkpointId to retrieve a previously saved checkpoint and its diff.',
        'Set action="list" to see all saved checkpoints for the current conversation.',
        'The action parameter is always required and must be one of: save, get, list.',
      ],
      parameters: CheckpointToolParams,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const profile = options.getCurrentProfile();
        const conversationId = ctx.sessionManager.getSessionId();

        switch (params.action as CheckpointAction) {
          case 'list': {
            const checkpoints = listConversationCommitCheckpoints({
              stateRoot: options.stateRoot,
              profile,
              conversationId,
            });

            return {
              content: [{ type: 'text' as const, text: formatCheckpointList(conversationId, checkpoints) }],
              details: {
                action: 'list',
                conversationId,
                checkpointCount: checkpoints.length,
                checkpointIds: checkpoints.map((checkpoint) => checkpoint.id),
              },
            };
          }

          case 'get': {
            const checkpointId = readRequiredString(params.checkpointId, 'checkpointId');
            const record = getConversationCommitCheckpoint({
              stateRoot: options.stateRoot,
              profile,
              conversationId,
              checkpointId,
            });
            if (!record) {
              throw new Error(`Commit checkpoint ${checkpointId} was not found.`);
            }

            return {
              content: [{ type: 'text' as const, text: formatCheckpoint(record) }],
              details: {
                action: 'get',
                conversationId,
                checkpointId: record.id,
                commitSha: record.commitSha,
                shortSha: record.shortSha,
                title: record.title,
                subject: record.subject,
                fileCount: record.fileCount,
                linesAdded: record.linesAdded,
                linesDeleted: record.linesDeleted,
                updatedAt: record.updatedAt,
              },
            };
          }

          case 'save': {
            const cwd = readRequiredString(ctx.sessionManager.getCwd?.(), 'cwd');
            const message = readRequiredString(params.message, 'message');
            const paths = readPathInputs(cwd, params.paths);
            const created = createCheckpointCommit({ cwd, message, paths });
            const linesAdded = created.files.reduce((sum, file) => sum + file.additions, 0);
            const linesDeleted = created.files.reduce((sum, file) => sum + file.deletions, 0);
            const record = saveConversationCommitCheckpoint({
              stateRoot: options.stateRoot,
              profile,
              conversationId,
              checkpointId: params.checkpointId ?? created.metadata.commitSha,
              title: created.metadata.subject,
              cwd,
              commitSha: created.metadata.commitSha,
              shortSha: created.metadata.shortSha,
              subject: created.metadata.subject,
              body: created.metadata.body,
              authorName: created.metadata.authorName,
              authorEmail: created.metadata.authorEmail,
              committedAt: created.metadata.committedAt,
              files: created.files,
              linesAdded,
              linesDeleted,
            });
            invalidateAppTopics('checkpoints', 'sessions');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Saved checkpoint ${record.shortSha} ${record.subject} (${record.fileCount} files, +${record.linesAdded} -${record.linesDeleted}).`,
                },
              ],
              details: {
                action: 'save',
                conversationId,
                checkpointId: record.id,
                commitSha: record.commitSha,
                shortSha: record.shortSha,
                title: record.title,
                subject: record.subject,
                fileCount: record.fileCount,
                linesAdded: record.linesAdded,
                linesDeleted: record.linesDeleted,
                cwd: record.cwd,
                updatedAt: record.updatedAt,
                paths,
              },
            };
          }

          default:
            throw new Error(`Unsupported checkpoint action: ${String(params.action)}`);
        }
      },
    });
  };
}
