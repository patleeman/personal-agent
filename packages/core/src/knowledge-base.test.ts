import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeBaseManager } from './knowledge-base.js';

const createdDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function runGit(args: string[], cwd: string, env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function initBareRepo(): string {
  const repoRoot = createTempDir('pa-kb-remote-');
  runGit(['init', '--bare', '--initial-branch=main'], repoRoot);
  return repoRoot;
}

function seedRemoteRepo(remoteRepo: string, files: Record<string, string>, timestamp: string): void {
  const worktree = createTempDir('pa-kb-seed-');
  runGit(['clone', remoteRepo, worktree], dirname(worktree));
  runGit(['config', 'user.email', 'patrick@example.com'], worktree);
  runGit(['config', 'user.name', 'Patrick Lee'], worktree);

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(worktree, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  runGit(['add', '.'], worktree);
  runGit(['commit', '-m', 'seed'], worktree, {
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp,
  });
  runGit(['push', 'origin', 'main'], worktree);
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('KnowledgeBaseManager', () => {
  it('bootstraps and pushes a managed knowledge base into an empty remote repo', () => {
    const remoteRepo = initBareRepo();
    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });

    const state = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    expect(state.configured).toBe(true);
    expect(state.repoUrl).toBe(remoteRepo);
    expect(readFileSync(join(state.managedRoot, '.gitignore'), 'utf-8')).toContain('.obsidian/');
    expect(readFileSync(join(state.managedRoot, 'skills', '.gitkeep'), 'utf-8')).toBe('');
    expect(readFileSync(join(state.managedRoot, 'notes', '.gitkeep'), 'utf-8')).toBe('');

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(readFileSync(join(remoteClone, '.gitignore'), 'utf-8')).toContain('.DS_Store');
    expect(readFileSync(join(remoteClone, 'skills', '.gitkeep'), 'utf-8')).toBe('');
    expect(readFileSync(join(remoteClone, 'notes', '.gitkeep'), 'utf-8')).toBe('');
  });

  it('auto-resolves same-file collisions by keeping the newer remote version and saving a recovery copy', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Remote\nold\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const localFile = join(initialState.managedRoot, 'notes', 'daily.md');
    writeFileSync(localFile, '# Local\nolder\n');
    utimesSync(localFile, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));

    const remoteEditor = createTempDir('pa-kb-editor-');
    runGit(['clone', remoteRepo, remoteEditor], dirname(remoteEditor));
    runGit(['config', 'user.email', 'patrick@example.com'], remoteEditor);
    runGit(['config', 'user.name', 'Patrick Lee'], remoteEditor);
    writeFileSync(join(remoteEditor, 'notes', 'daily.md'), '# Remote\nnewer\n');
    runGit(['add', 'notes/daily.md'], remoteEditor);
    runGit(['commit', '-m', 'remote edit'], remoteEditor, {
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    });
    runGit(['push', 'origin', 'main'], remoteEditor);

    const syncedState = manager.syncNow();

    expect(readFileSync(localFile, 'utf-8')).toBe('# Remote\nnewer\n');
    expect(syncedState.recoveredEntryCount).toBeGreaterThan(0);

    const recoveryRoot = syncedState.recoveryDir;
    const recoveryDirs = readDirNames(recoveryRoot);
    expect(recoveryDirs.length).toBeGreaterThan(0);
    const recoveryFile = join(recoveryRoot, recoveryDirs[0] as string, 'notes', 'daily.md');
    expect(readFileSync(recoveryFile, 'utf-8')).toBe('# Local\nolder\n');
  });
});

function readDirNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
