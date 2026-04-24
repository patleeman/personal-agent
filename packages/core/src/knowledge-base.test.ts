import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
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

function readGitConfigValues(cwd: string, key: string): string[] {
  const output = runGit(['config', '--get-all', key], cwd);
  return output.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length > 0);
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

function readKnowledgeBaseStateFile(stateRoot: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(stateRoot, 'knowledge-base', 'state.json'), 'utf-8')) as Record<string, unknown>;
}

function writeMachineConfigFile(configRoot: string, config: Record<string, unknown>): void {
  mkdirSync(configRoot, { recursive: true });
  writeFileSync(join(configRoot, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

function writeSyncLock(stateRoot: string, metadata: { pid: number; acquiredAt: string }): void {
  const lockDir = join(stateRoot, 'knowledge-base', 'sync.lock');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(join(lockDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
}

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

    const storedState = readKnowledgeBaseStateFile(stateRoot);
    expect(typeof storedState.lastMaintenanceAt).toBe('string');
    expect(storedState.lastFullMaintenanceAt).toBeUndefined();
  });

  it('does not import the old unmanaged vault into an empty managed repo on first enable', () => {
    const remoteRepo = initBareRepo();
    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const legacyVaultRoot = createTempDir('pa-kb-legacy-');
    writeMachineConfigFile(configRoot, { vaultRoot: legacyVaultRoot });

    writeFileSync(join(legacyVaultRoot, 'AGENTS.md'), '# Agent\n');
    mkdirSync(join(legacyVaultRoot, 'notes'), { recursive: true });
    writeFileSync(join(legacyVaultRoot, 'notes', 'daily.md'), '# Daily\n');
    mkdirSync(join(legacyVaultRoot, 'skills', 'capture'), { recursive: true });
    writeFileSync(join(legacyVaultRoot, 'skills', 'capture', 'SKILL.md'), '# Capture\n');

    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const state = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    expect(existsSync(join(state.managedRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(state.managedRoot, 'notes', 'daily.md'))).toBe(false);
    expect(existsSync(join(state.managedRoot, 'skills', 'capture', 'SKILL.md'))).toBe(false);

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(existsSync(join(remoteClone, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(remoteClone, 'notes', 'daily.md'))).toBe(false);
    expect(existsSync(join(remoteClone, 'skills', 'capture', 'SKILL.md'))).toBe(false);
  });

  it('does not import the old unmanaged vault into an already-configured bootstrap-only repo on the next sync', () => {
    const remoteRepo = initBareRepo();
    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    writeMachineConfigFile(configRoot, { vaultRoot: join(stateRoot, 'missing-legacy-root') });
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });

    manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const legacyVaultRoot = createTempDir('pa-kb-legacy-');
    writeFileSync(join(legacyVaultRoot, 'AGENTS.md'), '# Imported later\n');
    mkdirSync(join(legacyVaultRoot, 'projects', 'kb-migration'), { recursive: true });
    writeFileSync(join(legacyVaultRoot, 'projects', 'kb-migration', 'plan.md'), '# Plan\n');
    writeMachineConfigFile(configRoot, {
      knowledgeBaseRepoUrl: remoteRepo,
      knowledgeBaseBranch: 'main',
      vaultRoot: legacyVaultRoot,
    });

    const syncedState = manager.syncNow();
    expect(existsSync(join(syncedState.managedRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(syncedState.managedRoot, 'projects', 'kb-migration', 'plan.md'))).toBe(false);

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(existsSync(join(remoteClone, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(remoteClone, 'projects', 'kb-migration', 'plan.md'))).toBe(false);
  });

  it('does not import the old unmanaged vault into a non-empty managed repo', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/remote.md': '# Remote\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const legacyVaultRoot = createTempDir('pa-kb-legacy-');
    writeFileSync(join(legacyVaultRoot, 'AGENTS.md'), '# Should stay local\n');
    writeMachineConfigFile(configRoot, { vaultRoot: legacyVaultRoot });

    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const state = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    expect(existsSync(join(state.managedRoot, 'AGENTS.md'))).toBe(false);
    expect(readFileSync(join(state.managedRoot, 'notes', 'remote.md'), 'utf-8')).toBe('# Remote\n');

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(existsSync(join(remoteClone, 'AGENTS.md'))).toBe(false);
    expect(readFileSync(join(remoteClone, 'notes', 'remote.md'), 'utf-8')).toBe('# Remote\n');
  });

  it('does not invent placeholder gitkeep files in an existing remote repo', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/remote.md': '# Remote\n',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const state = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    expect(existsSync(join(state.managedRoot, 'notes', '.gitkeep'))).toBe(false);
    expect(existsSync(join(state.managedRoot, 'skills', '.gitkeep'))).toBe(false);

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(existsSync(join(remoteClone, 'notes', '.gitkeep'))).toBe(false);
    expect(existsSync(join(remoteClone, 'skills', '.gitkeep'))).toBe(false);
  });

  it('honors remote deletion of a placeholder gitkeep instead of recreating it', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const remoteEditor = createTempDir('pa-kb-editor-');
    runGit(['clone', remoteRepo, remoteEditor], dirname(remoteEditor));
    runGit(['config', 'user.email', 'patrick@example.com'], remoteEditor);
    runGit(['config', 'user.name', 'Patrick Lee'], remoteEditor);
    rmSync(join(remoteEditor, 'notes', '.gitkeep'), { force: true });
    writeFileSync(join(remoteEditor, 'notes', 'remote.md'), '# Remote\n');
    runGit(['add', '--all'], remoteEditor);
    runGit(['commit', '-m', 'replace notes placeholder'], remoteEditor, {
      GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z',
    });
    runGit(['push', 'origin', 'main'], remoteEditor);

    manager.syncNow();

    expect(existsSync(join(initialState.managedRoot, 'notes', '.gitkeep'))).toBe(false);
    expect(readFileSync(join(initialState.managedRoot, 'notes', 'remote.md'), 'utf-8')).toBe('# Remote\n');

    const remoteClone = createTempDir('pa-kb-verify-');
    runGit(['clone', remoteRepo, remoteClone], dirname(remoteClone));
    expect(existsSync(join(remoteClone, 'notes', '.gitkeep'))).toBe(false);
    expect(readFileSync(join(remoteClone, 'notes', 'remote.md'), 'utf-8')).toBe('# Remote\n');
  });

  it('normalizes duplicated upstream tracking config during sync', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Seed\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });
    const managedRoot = initialState.managedRoot;

    runGit(['config', '--add', 'branch.main.remote', 'origin'], managedRoot);
    runGit(['config', '--add', 'branch.main.merge', 'refs/heads/main'], managedRoot);
    runGit(['config', '--add', 'branch.main.merge', 'refs/heads/main'], managedRoot);
    expect(readGitConfigValues(managedRoot, 'branch.main.remote')).toEqual(['origin', 'origin']);
    expect(readGitConfigValues(managedRoot, 'branch.main.merge')).toEqual([
      'refs/heads/main',
      'refs/heads/main',
      'refs/heads/main',
    ]);

    manager.syncNow();

    expect(readGitConfigValues(managedRoot, 'branch.main.remote')).toEqual(['origin']);
    expect(readGitConfigValues(managedRoot, 'branch.main.merge')).toEqual(['refs/heads/main']);
    expect(runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], managedRoot).trim()).toBe('origin/main');
    expect(() => runGit(['push', '--dry-run'], managedRoot)).not.toThrow();
  });

  it('reports local and remote git sync drift for the managed mirror', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Seed\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    expect(initialState.gitStatus).toEqual({
      localChangeCount: 0,
      aheadCount: 0,
      behindCount: 0,
    });

    const managedRoot = initialState.managedRoot;
    const managedFile = join(managedRoot, 'notes', 'daily.md');
    writeFileSync(managedFile, '# Seed\nlocal edit\n');

    const dirtyState = manager.readKnowledgeBaseState();
    expect(dirtyState.gitStatus?.localChangeCount).toBe(1);
    expect(dirtyState.gitStatus?.aheadCount).toBe(0);
    expect(dirtyState.gitStatus?.behindCount).toBe(0);

    runGit(['config', 'user.email', 'patrick@example.com'], managedRoot);
    runGit(['config', 'user.name', 'Patrick Lee'], managedRoot);
    runGit(['add', 'notes/daily.md'], managedRoot);
    runGit(['commit', '-m', 'local edit'], managedRoot, {
      GIT_AUTHOR_DATE: '2026-02-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-02-01T00:00:00Z',
    });

    const aheadState = manager.readKnowledgeBaseState();
    expect(aheadState.gitStatus?.localChangeCount).toBe(0);
    expect(aheadState.gitStatus?.aheadCount).toBe(1);
    expect(aheadState.gitStatus?.behindCount).toBe(0);

    const remoteEditor = createTempDir('pa-kb-editor-');
    runGit(['clone', remoteRepo, remoteEditor], dirname(remoteEditor));
    runGit(['config', 'user.email', 'patrick@example.com'], remoteEditor);
    runGit(['config', 'user.name', 'Patrick Lee'], remoteEditor);
    writeFileSync(join(remoteEditor, 'notes', 'remote.md'), '# Remote\n');
    runGit(['add', 'notes/remote.md'], remoteEditor);
    runGit(['commit', '-m', 'remote edit'], remoteEditor, {
      GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z',
    });
    runGit(['push', 'origin', 'main'], remoteEditor);

    runGit(['fetch', 'origin'], managedRoot);
    const divergedState = manager.readKnowledgeBaseState();
    expect(divergedState.gitStatus?.localChangeCount).toBe(0);
    expect(divergedState.gitStatus?.aheadCount).toBe(1);
    expect(divergedState.gitStatus?.behindCount).toBe(1);
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

  it('skips sync work while another live process holds the cross-process lock', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Seed\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const remoteEditor = createTempDir('pa-kb-editor-');
    runGit(['clone', remoteRepo, remoteEditor], dirname(remoteEditor));
    runGit(['config', 'user.email', 'patrick@example.com'], remoteEditor);
    runGit(['config', 'user.name', 'Patrick Lee'], remoteEditor);
    writeFileSync(join(remoteEditor, 'notes', 'remote.md'), '# Remote\n');
    runGit(['add', 'notes/remote.md'], remoteEditor);
    runGit(['commit', '-m', 'remote edit'], remoteEditor, {
      GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z',
    });
    runGit(['push', 'origin', 'main'], remoteEditor);

    writeSyncLock(stateRoot, { pid: process.pid, acquiredAt: new Date().toISOString() });

    const skippedState = manager.syncNow();
    expect(skippedState.lastSyncAt).toBe(initialState.lastSyncAt);
    expect(existsSync(join(initialState.managedRoot, 'notes', 'remote.md'))).toBe(false);

    rmSync(join(stateRoot, 'knowledge-base', 'sync.lock'), { recursive: true, force: true });
    manager.syncNow();
    expect(readFileSync(join(initialState.managedRoot, 'notes', 'remote.md'), 'utf-8')).toBe('# Remote\n');
  });

  it('reclaims a stale sync lock before syncing', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Seed\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    const initialState = manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const remoteEditor = createTempDir('pa-kb-editor-');
    runGit(['clone', remoteRepo, remoteEditor], dirname(remoteEditor));
    runGit(['config', 'user.email', 'patrick@example.com'], remoteEditor);
    runGit(['config', 'user.name', 'Patrick Lee'], remoteEditor);
    writeFileSync(join(remoteEditor, 'notes', 'stale-lock.md'), '# Remote\n');
    runGit(['add', 'notes/stale-lock.md'], remoteEditor);
    runGit(['commit', '-m', 'remote edit'], remoteEditor, {
      GIT_AUTHOR_DATE: '2026-03-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-03-01T00:00:00Z',
    });
    runGit(['push', 'origin', 'main'], remoteEditor);

    writeSyncLock(stateRoot, { pid: 999_999, acquiredAt: '2026-01-01T00:00:00.000Z' });

    manager.syncNow();
    expect(readFileSync(join(initialState.managedRoot, 'notes', 'stale-lock.md'), 'utf-8')).toBe('# Remote\n');
    expect(existsSync(join(stateRoot, 'knowledge-base', 'sync.lock'))).toBe(false);
  });

  it('runs a full maintenance pass when the prior one is stale', () => {
    const remoteRepo = initBareRepo();
    seedRemoteRepo(remoteRepo, {
      'notes/daily.md': '# Seed\n',
      '.gitignore': '.DS_Store\n.obsidian/\n',
      'skills/.gitkeep': '',
      'notes/.gitkeep': '',
    }, '2025-01-01T00:00:00Z');

    const stateRoot = createTempDir('pa-kb-state-');
    const configRoot = createTempDir('pa-kb-config-');
    const manager = new KnowledgeBaseManager({ stateRoot, configRoot });
    manager.updateKnowledgeBase({ repoUrl: remoteRepo, branch: 'main' });

    const stateFilePath = join(stateRoot, 'knowledge-base', 'state.json');
    const storedBefore = readKnowledgeBaseStateFile(stateRoot);
    storedBefore.lastMaintenanceAt = '2026-01-01T00:00:00.000Z';
    storedBefore.lastFullMaintenanceAt = '2026-01-01T00:00:00.000Z';
    writeFileSync(stateFilePath, `${JSON.stringify(storedBefore, null, 2)}\n`);

    const managedFile = join(stateRoot, 'knowledge-base', 'repo', 'notes', 'daily.md');
    writeFileSync(managedFile, '# Seed\nlocal edit\n');
    utimesSync(managedFile, new Date('2026-04-16T00:00:00Z'), new Date('2026-04-16T00:00:00Z'));

    manager.syncNow();

    const storedAfter = readKnowledgeBaseStateFile(stateRoot);
    expect(typeof storedAfter.lastFullMaintenanceAt).toBe('string');
    expect(Date.parse(String(storedAfter.lastFullMaintenanceAt))).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
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
