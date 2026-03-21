/**
 * Tests for runtime state bootstrap validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, readlinkSync, symlinkSync } from 'fs';
import { mkdtemp, rm, mkdir, chmod, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import {
  bootstrapState,
  bootstrapStateOrThrow,
  canBootstrap,
  getDurableSessionsDir,
  preparePiAgentDir,
  type RuntimeStatePaths,
} from './index.js';

describe('bootstrapState', () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await mkdtemp(join(tmpdir(), 'pa-test-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should create directories that do not exist', async () => {
    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const result = await bootstrapState(paths);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should succeed when directories already exist', async () => {
    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    // Create directories first
    await mkdir(paths.auth, { recursive: true });
    await mkdir(paths.session, { recursive: true });
    await mkdir(paths.cache, { recursive: true });

    const result = await bootstrapState(paths);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should report error when parent is not writable', async () => {
    // Create a read-only parent directory
    const readOnlyParent = join(tempDir, 'readonly');
    await mkdir(readOnlyParent, { mode: 0o500 });

    const paths: RuntimeStatePaths = {
      root: join(readOnlyParent, 'state'),
      auth: join(readOnlyParent, 'state', 'auth'),
      session: join(readOnlyParent, 'state', 'session'),
      cache: join(readOnlyParent, 'state', 'cache'),
    };

    const result = await bootstrapState(paths);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].type).toBe('permission');

    // Restore permissions for cleanup
    await chmod(readOnlyParent, 0o700);
  });

  it('should validate all paths and report all errors', async () => {
    // Create two separate read-only parents
    const readOnlyAuth = join(tempDir, 'readonly-auth');
    const readOnlySession = join(tempDir, 'readonly-session');
    await mkdir(readOnlyAuth, { mode: 0o500 });
    await mkdir(readOnlySession, { mode: 0o500 });

    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(readOnlyAuth, 'auth'),
      session: join(readOnlySession, 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const result = await bootstrapState(paths);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(2);

    // Restore permissions for cleanup
    await chmod(readOnlyAuth, 0o700);
    await chmod(readOnlySession, 0o700);
  });
});

describe('bootstrapStateOrThrow', () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await mkdtemp(join(tmpdir(), 'pa-test-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should not throw when bootstrap succeeds', async () => {
    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    await expect(bootstrapStateOrThrow(paths)).resolves.not.toThrow();
  });

  it('should throw with actionable error when bootstrap fails', async () => {
    const readOnlyParent = join(tempDir, 'readonly');
    await mkdir(readOnlyParent, { mode: 0o500 });

    const paths: RuntimeStatePaths = {
      root: join(readOnlyParent, 'state'),
      auth: join(readOnlyParent, 'state', 'auth'),
      session: join(readOnlyParent, 'state', 'session'),
      cache: join(readOnlyParent, 'state', 'cache'),
    };

    await expect(bootstrapStateOrThrow(paths)).rejects.toThrow('Runtime state bootstrap failed');
    await expect(bootstrapStateOrThrow(paths)).rejects.toThrow('Suggestions');
    await expect(bootstrapStateOrThrow(paths)).rejects.toThrow('PERSONAL_AGENT_STATE_ROOT');

    // Restore permissions for cleanup
    await chmod(readOnlyParent, 0o700);
  });
});

describe('canBootstrap', () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await mkdtemp(join(tmpdir(), 'pa-test-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return true for valid paths', async () => {
    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const result = await canBootstrap(paths);

    expect(result).toBe(true);
  });

  it('does not create directories during dry-run checks', async () => {
    const paths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const result = await canBootstrap(paths);

    expect(result).toBe(true);
    expect(existsSync(paths.auth)).toBe(false);
    expect(existsSync(paths.session)).toBe(false);
    expect(existsSync(paths.cache)).toBe(false);
  });

  it('should return false for invalid paths', async () => {
    const readOnlyParent = join(tempDir, 'readonly');
    await mkdir(readOnlyParent, { mode: 0o500 });

    const paths: RuntimeStatePaths = {
      root: join(readOnlyParent, 'state'),
      auth: join(readOnlyParent, 'state', 'auth'),
      session: join(readOnlyParent, 'state', 'session'),
      cache: join(readOnlyParent, 'state', 'cache'),
    };

    const result = await canBootstrap(paths);

    expect(result).toBe(false);

    // Restore permissions for cleanup
    await chmod(readOnlyParent, 0o700);
  });
});

describe('integration: path resolution with bootstrap', () => {
  let tempDir: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await mkdtemp(join(tmpdir(), 'pa-test-'));
  });

  afterEach(async () => {
    process.env = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should use environment variable overrides in bootstrap', async () => {
    process.env.PERSONAL_AGENT_STATE_ROOT = join(tempDir, 'custom-state');
    
    const { resolveStatePaths } = await import('./paths.js');
    const paths = resolveStatePaths();

    const result = await bootstrapState(paths);

    expect(result.success).toBe(true);
    expect(paths.root).toBe(join(tempDir, 'custom-state'));
  });

  it('should use individual path overrides in bootstrap', async () => {
    process.env.PERSONAL_AGENT_AUTH_PATH = join(tempDir, 'secure', 'auth');
    process.env.PERSONAL_AGENT_SESSION_PATH = join(tempDir, 'tmp', 'sessions');
    process.env.PERSONAL_AGENT_CACHE_PATH = join(tempDir, 'var', 'cache');

    const { resolveStatePaths } = await import('./paths.js');
    const paths = resolveStatePaths();

    const result = await bootstrapState(paths);

    expect(result.success).toBe(true);
    expect(paths.auth).toBe(join(tempDir, 'secure', 'auth'));
    expect(paths.session).toBe(join(tempDir, 'tmp', 'sessions'));
    expect(paths.cache).toBe(join(tempDir, 'var', 'cache'));
  });
});

describe('preparePiAgentDir', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pa-agent-dir-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates a machine-local runtime dir with sessions linked to durable state', async () => {
    const statePaths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const result = await preparePiAgentDir({
      statePaths,
      copyLegacyAuth: false,
    });

    expect(result.agentDir).toBe(join(statePaths.root, 'pi-agent-runtime'));
    expect(result.sessionsDir).toBe(join(statePaths.root, 'pi-agent-runtime', 'sessions'));
    expect(result.copiedLegacyAuth).toBe(false);
    expect(lstatSync(result.sessionsDir).isSymbolicLink()).toBe(true);
    expect(resolve(dirname(result.sessionsDir), readlinkSync(result.sessionsDir)))
      .toBe(join(statePaths.root, 'sync', 'pi-agent', 'sessions'));
  });

  it('moves machine-local runtime artifacts out of the durable synced pi-agent dir', async () => {
    const statePaths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const staleAgentsFile = join(statePaths.root, 'sync', 'pi-agent', 'AGENTS.md');
    const staleSettingsFile = join(statePaths.root, 'sync', 'pi-agent', 'settings.json');
    const runtimeSettingsFile = join(statePaths.root, 'pi-agent-runtime', 'settings.json');
    await mkdir(join(statePaths.root, 'sync', 'pi-agent'), { recursive: true });
    await writeFile(staleAgentsFile, '# stale\n');
    await writeFile(staleSettingsFile, '{"theme":"legacy"}\n');

    await preparePiAgentDir({
      statePaths,
      copyLegacyAuth: false,
    });

    expect(existsSync(staleAgentsFile)).toBe(false);
    expect(existsSync(staleSettingsFile)).toBe(false);
    expect(await readFile(runtimeSettingsFile, 'utf-8')).toContain('legacy');
  });

  it('moves misplaced local session transcripts into the synced durable sessions dir', async () => {
    const statePaths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const legacySessionFile = join(statePaths.root, 'pi-agent', 'sessions', '--tmp-project--', '2026-03-21T18-00-00-000Z_local.jsonl');
    const durableSessionFile = join(getDurableSessionsDir(statePaths.root), '--tmp-project--', '2026-03-21T18-05-00-000Z_synced.jsonl');

    await mkdir(dirname(legacySessionFile), { recursive: true });
    await mkdir(dirname(durableSessionFile), { recursive: true });
    await writeFile(legacySessionFile, '{"type":"session","id":"local-session","timestamp":"2026-03-21T18:00:00.000Z","cwd":"/tmp/project"}\n');
    await writeFile(durableSessionFile, '{"type":"session","id":"synced-session","timestamp":"2026-03-21T18:05:00.000Z","cwd":"/tmp/project"}\n');

    const result = await preparePiAgentDir({
      statePaths,
      copyLegacyAuth: false,
    });

    expect(resolve(dirname(result.sessionsDir), readlinkSync(result.sessionsDir))).toBe(getDurableSessionsDir(statePaths.root));
    expect(existsSync(legacySessionFile)).toBe(false);
    expect(await readFile(join(getDurableSessionsDir(statePaths.root), '--tmp-project--', '2026-03-21T18-00-00-000Z_local.jsonl'), 'utf-8'))
      .toContain('local-session');
    expect(await readFile(durableSessionFile, 'utf-8')).toContain('synced-session');
  });

  it('replaces a broken legacy runtime sessions symlink', async () => {
    const statePaths: RuntimeStatePaths = {
      root: join(tempDir, 'state'),
      auth: join(tempDir, 'state', 'auth'),
      session: join(tempDir, 'state', 'session'),
      cache: join(tempDir, 'state', 'cache'),
    };

    const runtimeSessionsDir = join(statePaths.root, 'pi-agent-runtime', 'sessions');
    await mkdir(dirname(runtimeSessionsDir), { recursive: true });
    symlinkSync('../pi-agent/sessions', runtimeSessionsDir, 'dir');

    const result = await preparePiAgentDir({
      statePaths,
      copyLegacyAuth: false,
    });

    expect(lstatSync(result.sessionsDir).isSymbolicLink()).toBe(true);
    expect(resolve(dirname(result.sessionsDir), readlinkSync(result.sessionsDir))).toBe(getDurableSessionsDir(statePaths.root));
  });
});
