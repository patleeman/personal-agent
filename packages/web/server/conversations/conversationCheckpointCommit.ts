import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

export interface LocalCheckpointCommitMetadata {
  commitSha: string;
  shortSha: string;
  subject: string;
  body?: string;
  authorName: string;
  authorEmail?: string;
  committedAt: string;
}

export interface LocalCheckpointCommitFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  additions: number;
  deletions: number;
  patch: string;
}

export interface LocalCheckpointCommitResult {
  metadata: LocalCheckpointCommitMetadata;
  files: LocalCheckpointCommitFile[];
  linesAdded: number;
  linesDeleted: number;
}

export function readRequiredCheckpointString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

export function normalizeCheckpointPaths(cwd: string, values: string[]): string[] {
  const seen = new Set<string>();
  const normalizedPaths: string[] = [];

  for (const rawValue of values) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === '.' || trimmed === './') {
      return ['.'];
    }

    const relativePath = isAbsolute(trimmed)
      ? relative(cwd, resolve(trimmed))
      : trimmed.replace(/^\.\//, '');
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

function runCheckpointGit(cwd: string, args: string[], options: { allowEmptyStdout?: boolean } = {}): string {
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
    throw new Error(stderr || stdout || `git ${args.join(' ')} failed with status ${result.status}`);
  }
  const stdout = `${result.stdout ?? ''}`;
  if (!options.allowEmptyStdout && stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} returned no output.`);
  }
  return stdout;
}

function parseCheckpointCommitMetadata(raw: string): LocalCheckpointCommitMetadata {
  const [commitSha = '', shortSha = '', subject = '', body = '', authorName = '', authorEmail = '', committedAt = ''] = raw.split('\u0000');
  return {
    commitSha: readRequiredCheckpointString(commitSha, 'commitSha'),
    shortSha: readRequiredCheckpointString(shortSha, 'shortSha'),
    subject: readRequiredCheckpointString(subject, 'subject'),
    ...(body.trim().length > 0 ? { body: body.trim() } : {}),
    authorName: readRequiredCheckpointString(authorName, 'authorName'),
    ...(authorEmail.trim().length > 0 ? { authorEmail: authorEmail.trim() } : {}),
    committedAt: readRequiredCheckpointString(committedAt, 'committedAt'),
  };
}

function unquoteCheckpointGitPath(value: string): string {
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

function stripCheckpointGitDiffPrefix(value: string, prefix: 'a/' | 'b/'): string {
  const unquoted = unquoteCheckpointGitPath(value);
  if (unquoted === '/dev/null') {
    return unquoted;
  }
  return unquoted.startsWith(prefix) ? unquoted.slice(prefix.length) : unquoted;
}

export function parseCheckpointDiffSections(rawPatch: string): LocalCheckpointCommitFile[] {
  const normalized = rawPatch.replace(/\r\n/g, '\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of normalized.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current.length > 0) {
        sections.push(current.join('\n'));
      }
      current = [line];
      continue;
    }
    if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join('\n'));
  }

  return sections.map((section) => {
    const lines = section.split('\n');
    const diffHeader = lines[0] ?? '';
    const diffMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(diffHeader);
    if (!diffMatch) {
      throw new Error('Could not parse git diff header for checkpoint review.');
    }
    let oldPath = stripCheckpointGitDiffPrefix(diffMatch[1] ?? '', 'a/');
    let newPath = stripCheckpointGitDiffPrefix(diffMatch[2] ?? '', 'b/');
    for (const line of lines) {
      if (line.startsWith('--- ')) {
        oldPath = stripCheckpointGitDiffPrefix(line.slice(4), 'a/');
      } else if (line.startsWith('+++ ')) {
        newPath = stripCheckpointGitDiffPrefix(line.slice(4), 'b/');
      }
    }
    const path = newPath === '/dev/null' ? oldPath : newPath;
    const previousPath = oldPath !== '/dev/null' && oldPath !== path ? oldPath : undefined;
    let status: LocalCheckpointCommitFile['status'] = oldPath === '/dev/null'
      ? 'added'
      : newPath === '/dev/null'
        ? 'deleted'
        : previousPath
          ? 'renamed'
          : 'modified';
    if (lines.some((line) => line.startsWith('copy from '))) {
      status = 'copied';
    }
    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+++ ') || line.startsWith('--- ')) {
        continue;
      }
      if (line.startsWith('+')) {
        additions += 1;
      } else if (line.startsWith('-')) {
        deletions += 1;
      }
    }
    return {
      path,
      ...(previousPath ? { previousPath } : {}),
      status,
      additions,
      deletions,
      patch: section.trimEnd(),
    };
  });
}

export function createConversationCheckpointCommit(options: { cwd: string; message: string; paths: string[] }): LocalCheckpointCommitResult {
  runCheckpointGit(options.cwd, ['rev-parse', '--show-toplevel']);
  runCheckpointGit(options.cwd, ['add', '--all', '--', ...options.paths], { allowEmptyStdout: true });

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

  runCheckpointGit(options.cwd, ['commit', '--only', '-m', options.message, '--', ...options.paths], { allowEmptyStdout: true });
  const commitSha = runCheckpointGit(options.cwd, ['rev-parse', 'HEAD']).trim();
  const metadata = parseCheckpointCommitMetadata(runCheckpointGit(options.cwd, ['show', '-s', `--format=%H%x00%h%x00%s%x00%B%x00%an%x00%ae%x00%cI`, commitSha]));
  const rawPatch = runCheckpointGit(options.cwd, ['show', '--format=', '--patch', '--find-renames', '--find-copies', '--no-color', '--unified=3', commitSha], { allowEmptyStdout: true });
  const files = parseCheckpointDiffSections(rawPatch);
  return {
    metadata,
    files,
    linesAdded: files.reduce((sum, file) => sum + file.additions, 0),
    linesDeleted: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}
