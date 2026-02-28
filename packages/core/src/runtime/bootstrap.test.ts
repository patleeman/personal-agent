/**
 * Tests for runtime state bootstrap validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  bootstrapState,
  bootstrapStateOrThrow,
  canBootstrap,
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

  it('creates runtime pi-agent directory and sessions directory', async () => {
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

    expect(result.agentDir).toBe(join(statePaths.root, 'pi-agent'));
    expect(result.sessionsDir).toBe(join(statePaths.root, 'pi-agent', 'sessions'));
    expect(result.copiedLegacyAuth).toBe(false);
  });
});
