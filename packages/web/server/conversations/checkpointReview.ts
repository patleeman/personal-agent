import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getConversationCommitCheckpoint, type ConversationCommitCheckpointFile, type ConversationCommitCheckpointRecord } from '@personal-agent/core';

interface GitHubRepoRef {
  owner: string;
  repo: string;
  repoUrl: string;
}

interface GitHubPullRequestSummary {
  url: string;
  title?: string;
  number?: number;
}

export interface ConversationCheckpointReviewContextResult {
  conversationId: string;
  checkpointId: string;
  github: {
    provider: 'github';
    repoUrl: string;
    commitUrl: string;
    pullRequestUrl?: string;
    pullRequestTitle?: string;
    pullRequestNumber?: number;
  } | null;
  structuralDiff: {
    available: boolean;
    command?: string;
  };
}

export interface ConversationCheckpointStructuralDiffResult {
  conversationId: string;
  checkpointId: string;
  filePath: string;
  display: 'inline' | 'side-by-side';
  available: boolean;
  content?: string;
}

let cachedDifftasticCommand: string | null | undefined;

function runGit(cwd: string, args: string[], options?: { encoding?: BufferEncoding | 'buffer'; timeout?: number }): string | Buffer | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: options?.encoding ?? 'utf-8',
    timeout: options?.timeout ?? 4_000,
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout as string | Buffer;
}

export function parseGitHubRemoteUrl(value: string): GitHubRepoRef | null {
  const remote = value.trim();
  const patterns = [
    /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?$/i,
    /^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+?)(?:\.git)?\/?$/i,
  ];

  for (const pattern of patterns) {
    const match = remote.match(pattern);
    const owner = match?.groups?.owner?.trim();
    const repo = match?.groups?.repo?.trim();
    if (owner && repo) {
      return {
        owner,
        repo,
        repoUrl: `https://github.com/${owner}/${repo}`,
      };
    }
  }

  return null;
}

export function detectDifftasticCommand(): string | null {
  if (cachedDifftasticCommand !== undefined) {
    return cachedDifftasticCommand;
  }

  for (const command of ['difft', 'difftastic']) {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf-8',
      timeout: 2_000,
    });
    if (!result.error && result.status === 0) {
      cachedDifftasticCommand = command;
      return command;
    }
  }

  cachedDifftasticCommand = null;
  return null;
}

function sanitizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const segments = normalized
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');

  return segments.length > 0 ? segments.join('/') : basename(normalized) || 'file.txt';
}

function readGitFileBuffer(cwd: string, spec: string): Buffer | null {
  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'buffer',
    timeout: 4_000,
  });
  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout as Buffer;
}

function resolveCheckpointFileVersions(checkpoint: ConversationCommitCheckpointRecord, file: ConversationCommitCheckpointFile): {
  before: Buffer;
  after: Buffer;
} {
  const cwd = checkpoint.cwd;
  const previousPath = sanitizeRelativePath(file.previousPath ?? file.path);
  const nextPath = sanitizeRelativePath(file.path);
  const before = file.status === 'added'
    ? Buffer.alloc(0)
    : (readGitFileBuffer(cwd, `${checkpoint.commitSha}^:${previousPath}`) ?? Buffer.alloc(0));
  const after = file.status === 'deleted'
    ? Buffer.alloc(0)
    : (readGitFileBuffer(cwd, `${checkpoint.commitSha}:${nextPath}`) ?? Buffer.alloc(0));

  return { before, after };
}

function writeTempVersion(root: string, relativePath: string, content: Buffer): string {
  const safeRelativePath = sanitizeRelativePath(relativePath);
  const outputPath = join(root, safeRelativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
  return outputPath;
}

async function fetchGitHubPullRequest(repo: GitHubRepoRef, commitSha: string): Promise<GitHubPullRequestSummary | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);

  try {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const response = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${commitSha}/pulls`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as Array<{
      html_url?: string;
      title?: string;
      number?: number;
      state?: string;
    }>;
    const pullRequest = payload.find((item) => item.state === 'open' && typeof item.html_url === 'string')
      ?? payload.find((item) => typeof item.html_url === 'string');
    if (!pullRequest?.html_url) {
      return null;
    }

    return {
      url: pullRequest.html_url,
      ...(typeof pullRequest.title === 'string' ? { title: pullRequest.title } : {}),
      ...(typeof pullRequest.number === 'number' ? { number: pullRequest.number } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readGitHubInfoForCheckpoint(checkpoint: ConversationCommitCheckpointRecord): Promise<ConversationCheckpointReviewContextResult['github']> {
  const remoteUrl = runGit(checkpoint.cwd, ['remote', 'get-url', 'origin']);
  if (typeof remoteUrl !== 'string') {
    return null;
  }

  const repo = parseGitHubRemoteUrl(remoteUrl);
  if (!repo) {
    return null;
  }

  const commitUrl = `${repo.repoUrl}/commit/${checkpoint.commitSha}`;
  const pullRequest = await fetchGitHubPullRequest(repo, checkpoint.commitSha);

  return {
    provider: 'github',
    repoUrl: repo.repoUrl,
    commitUrl,
    ...(pullRequest ? {
      pullRequestUrl: pullRequest.url,
      pullRequestTitle: pullRequest.title,
      pullRequestNumber: pullRequest.number,
    } : {}),
  };
}

export async function readConversationCheckpointReviewContext(options: {
  profile: string;
  conversationId: string;
  checkpointId: string;
}): Promise<ConversationCheckpointReviewContextResult | null> {
  const checkpoint = getConversationCommitCheckpoint(options);
  if (!checkpoint) {
    return null;
  }

  const difftasticCommand = detectDifftasticCommand();

  return {
    conversationId: options.conversationId,
    checkpointId: checkpoint.id,
    github: await readGitHubInfoForCheckpoint(checkpoint),
    structuralDiff: {
      available: difftasticCommand !== null,
      ...(difftasticCommand ? { command: difftasticCommand } : {}),
    },
  };
}

export function readConversationCheckpointStructuralDiff(options: {
  profile: string;
  conversationId: string;
  checkpointId: string;
  filePath: string;
  display: 'inline' | 'side-by-side';
}): ConversationCheckpointStructuralDiffResult | null {
  const checkpoint = getConversationCommitCheckpoint(options);
  if (!checkpoint) {
    return null;
  }

  const difftasticCommand = detectDifftasticCommand();
  if (!difftasticCommand) {
    return {
      conversationId: options.conversationId,
      checkpointId: checkpoint.id,
      filePath: options.filePath,
      display: options.display,
      available: false,
    };
  }

  const file = checkpoint.files.find((candidate) => candidate.path === options.filePath);
  if (!file) {
    return null;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-checkpoint-structural-'));
  try {
    const { before, after } = resolveCheckpointFileVersions(checkpoint, file);
    const beforePath = writeTempVersion(join(tempRoot, 'before'), file.previousPath ?? file.path, before);
    const afterPath = writeTempVersion(join(tempRoot, 'after'), file.path, after);
    const displayMode = options.display === 'side-by-side' ? 'side-by-side-show-both' : 'inline';
    const width = options.display === 'side-by-side' ? '200' : '120';
    const result = spawnSync(difftasticCommand, [
      '--color=never',
      '--background=dark',
      '--display', displayMode,
      '--width', width,
      beforePath,
      afterPath,
    ], {
      encoding: 'utf-8',
      timeout: 8_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    if (result.error || (result.status !== 0 && !(result.stdout ?? '').trim())) {
      return {
        conversationId: options.conversationId,
        checkpointId: checkpoint.id,
        filePath: options.filePath,
        display: options.display,
        available: false,
      };
    }

    return {
      conversationId: options.conversationId,
      checkpointId: checkpoint.id,
      filePath: options.filePath,
      display: options.display,
      available: true,
      content: typeof result.stdout === 'string' ? result.stdout.trimEnd() : '',
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
