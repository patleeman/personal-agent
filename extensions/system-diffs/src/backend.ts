import { isAbsolute, relative, resolve } from 'node:path';

import {
  type ConversationCommitCheckpointFile,
  type ConversationCommitCheckpointFileStatus,
  type ExtensionBackendContext,
  getConversationCommitCheckpoint,
  listConversationCommitCheckpoints,
  saveConversationCommitCheckpoint,
} from '@personal-agent/extensions/backend/checkpoints';

type CheckpointBackendContext = ExtensionBackendContext & {
  profile: string;
  toolContext?: { conversationId?: string; cwd?: string };
};

type CheckpointAction = 'save' | 'get' | 'list';
interface CheckpointInput {
  action: CheckpointAction;
  checkpointId?: string;
  message?: string;
  paths?: string[];
}

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
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function readPathInputs(cwd: string, values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error('paths are required.');
  const seen = new Set<string>();
  const normalizedPaths: string[] = [];
  for (const rawValue of values) {
    const trimmed = rawValue.trim();
    if (!trimmed || trimmed === '.' || trimmed === './') continue;
    const relativePath = isAbsolute(trimmed) ? relative(cwd, resolve(trimmed)) : trimmed.replace(/^\.\//, '');
    const normalized = relativePath.replace(/\\/g, '/').trim();
    if (!normalized || normalized.startsWith('..')) throw new Error(`Invalid checkpoint path: ${rawValue}`);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      normalizedPaths.push(normalized);
    }
  }
  if (normalizedPaths.length === 0) throw new Error('paths are required.');
  return normalizedPaths;
}

async function runGit(
  ctx: CheckpointBackendContext,
  cwd: string,
  args: string[],
  options: { allowEmptyStdout?: boolean } = {},
): Promise<string> {
  const result = await ctx.shell.exec({ command: 'git', args, cwd, maxBuffer: 32 * 1024 * 1024 });
  const stdout = `${result.stdout ?? ''}`;
  if (!options.allowEmptyStdout && stdout.trim().length === 0) throw new Error(`git ${args.join(' ')} returned no output.`);
  return stdout;
}

function parseCommitMetadata(raw: string): ParsedCommitMetadata {
  const [commitSha = '', shortSha = '', subject = '', body = '', authorName = '', authorEmail = '', committedAt = ''] = raw.split('\u0000');
  return {
    commitSha: readRequiredString(commitSha, 'commitSha'),
    shortSha: readRequiredString(shortSha, 'shortSha'),
    subject: readRequiredString(subject, 'subject'),
    ...(body.trim() ? { body: body.trim() } : {}),
    authorName: readRequiredString(authorName, 'authorName'),
    ...(authorEmail.trim() ? { authorEmail: authorEmail.trim() } : {}),
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
  if (unquoted === '/dev/null') return unquoted;
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

function parseDiffSections(rawPatch: string): ConversationCommitCheckpointFile[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of rawPatch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) sections.push(current.join('\n').trimEnd());
      current = [line];
    } else if (current.length > 0) current.push(line);
  }
  if (current.length > 0) sections.push(current.join('\n').trimEnd());

  return sections.map((section) => {
    const lines = section.split('\n');
    const match = (lines[0] ?? '').match(/^diff --git (.+) (.+)$/);
    if (!match) throw new Error('Could not parse git diff header for checkpoint review.');
    const originalPath = stripGitDiffPrefix(match[1] ?? '', 'a/');
    const nextPath = stripGitDiffPrefix(match[2] ?? '', 'b/');
    let path = nextPath === '/dev/null' ? originalPath : nextPath;
    let previousPath: string | undefined;
    let status: ConversationCommitCheckpointFileStatus =
      originalPath === '/dev/null' ? 'added' : nextPath === '/dev/null' ? 'deleted' : 'modified';
    let additions = 0;
    let deletions = 0;
    for (const line of lines.slice(1)) {
      if (line.startsWith('new file mode ')) status = 'added';
      else if (line.startsWith('deleted file mode ')) status = 'deleted';
      else if (line.startsWith('rename from ')) {
        status = 'renamed';
        previousPath = line.slice('rename from '.length).trim();
      } else if (line.startsWith('rename to ')) {
        status = 'renamed';
        path = line.slice('rename to '.length).trim();
      } else if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    return {
      path: path.replace(/\\/g, '/'),
      ...(previousPath ? { previousPath: previousPath.replace(/\\/g, '/') } : {}),
      status,
      additions,
      deletions,
      patch: `${section}\n`,
    };
  });
}

async function createCheckpointCommit(ctx: CheckpointBackendContext, options: { cwd: string; message: string; paths: string[] }) {
  await runGit(ctx, options.cwd, ['rev-parse', '--show-toplevel']);
  await runGit(ctx, options.cwd, ['add', '--all', '--', ...options.paths], { allowEmptyStdout: true });
  const stagedFiles = await runGit(ctx, options.cwd, ['diff', '--cached', '--name-only', '--', ...options.paths], {
    allowEmptyStdout: true,
  });
  if (stagedFiles.trim().length === 0) throw new Error('No staged changes were found for the requested checkpoint paths.');
  await runGit(ctx, options.cwd, ['commit', '--only', '-m', options.message, '--', ...options.paths], { allowEmptyStdout: true });
  const commitSha = (await runGit(ctx, options.cwd, ['rev-parse', 'HEAD'])).trim();
  const metadata = parseCommitMetadata(
    await runGit(ctx, options.cwd, ['show', '-s', `--format=%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%cI`, commitSha]),
  );
  const rawPatch = await runGit(
    ctx,
    options.cwd,
    ['show', '--format=', '--patch', '--find-renames', '--find-copies', '--no-color', '--unified=3', commitSha],
    { allowEmptyStdout: true },
  );
  return { metadata, files: parseDiffSections(rawPatch) };
}

function formatCheckpointList(conversationId: string, checkpoints: ReturnType<typeof listConversationCommitCheckpoints>): string {
  if (checkpoints.length === 0) return `No commit checkpoints saved for conversation ${conversationId}.`;
  return [
    `Commit checkpoints for conversation ${conversationId}:`,
    ...checkpoints.map((c) => `- ${c.shortSha} ${c.subject} (${c.fileCount} files, +${c.linesAdded} -${c.linesDeleted})`),
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

export async function checkpoint(input: CheckpointInput, ctx: CheckpointBackendContext) {
  const profile = ctx.profile;
  const conversationId = readRequiredString(ctx.toolContext?.conversationId, 'conversationId');
  switch (input.action) {
    case 'list': {
      const checkpoints = listConversationCommitCheckpoints({ profile, conversationId });
      return {
        text: formatCheckpointList(conversationId, checkpoints),
        action: 'list',
        conversationId,
        checkpointCount: checkpoints.length,
        checkpointIds: checkpoints.map((c) => c.id),
      };
    }
    case 'get': {
      const checkpointId = readRequiredString(input.checkpointId, 'checkpointId');
      const record = getConversationCommitCheckpoint({ profile, conversationId, checkpointId });
      if (!record) throw new Error(`Commit checkpoint ${checkpointId} was not found.`);
      return {
        text: formatCheckpoint(record),
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
      };
    }
    case 'save': {
      const cwd = readRequiredString(ctx.toolContext?.cwd, 'cwd');
      const message = readRequiredString(input.message, 'message');
      const paths = readPathInputs(cwd, input.paths);
      const created = await createCheckpointCommit(ctx, { cwd, message, paths });
      const linesAdded = created.files.reduce((sum, file) => sum + file.additions, 0);
      const linesDeleted = created.files.reduce((sum, file) => sum + file.deletions, 0);
      const record = saveConversationCommitCheckpoint({
        profile,
        conversationId,
        checkpointId: input.checkpointId ?? created.metadata.commitSha,
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
      ctx.ui?.invalidate?.(['checkpoints', 'sessions']);
      return {
        text: `Saved checkpoint ${record.shortSha} ${record.subject} (${record.fileCount} files, +${record.linesAdded} -${record.linesDeleted}).`,
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
      };
    }
    default:
      throw new Error(`Unsupported checkpoint action: ${String(input.action)}`);
  }
}
