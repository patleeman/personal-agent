/**
 * Tests for runtime state path resolution
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfigRoot,
  getDefaultStateRoot,
  getDefaultVaultRoot,
  getLocalProfileDir,
  getProfilesRoot,
  getStateRoot,
  getSyncRoot,
  getDurablePiAgentDir,
  getDurableSessionsDir,
  getDurableConversationAttentionDir,
  getVaultRoot,
  getDurableProfilesDir,
  getDurableProfileDir,
  getDurableSettingsDir,
  getDurableModelsDir,
  getDurableSkillsDir,
  getDurableNodesDir,
  getDurableNotesDir,
  getDurableMemoryDir,
  getDurableTasksDir,
  getDurableProjectsDir,
  resolveStatePaths,
  isPathInRepo,
  validateStatePathsOutsideRepo,
  type RuntimeStatePaths,
} from './paths.js';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

describe('getDefaultStateRoot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.XDG_STATE_HOME;
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use XDG_STATE_HOME when set', () => {
    process.env.XDG_STATE_HOME = '/custom/state';
    expect(getDefaultStateRoot()).toBe('/custom/state/personal-agent');
  });

  it('should fall back to ~/.local/state/personal-agent', () => {
    delete process.env.XDG_STATE_HOME;
    expect(getDefaultStateRoot()).toBe(join(homedir(), '.local', 'state', 'personal-agent'));
  });
});

describe('getStateRoot', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    delete process.env.XDG_STATE_HOME;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return PERSONAL_AGENT_STATE_ROOT when set', () => {
    process.env.PERSONAL_AGENT_STATE_ROOT = '/custom/runtime/state';
    expect(getStateRoot()).toBe('/custom/runtime/state');
  });

  it('should fall back to default state root', () => {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    expect(getStateRoot()).toBe(getDefaultStateRoot());
  });
});

describe('profile and config path helpers', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    delete process.env.PERSONAL_AGENT_CONFIG_ROOT;
    delete process.env.PERSONAL_AGENT_PROFILES_ROOT;
    delete process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;
    delete process.env.PERSONAL_AGENT_VAULT_ROOT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('derives defaults from state root', () => {
    process.env.PERSONAL_AGENT_STATE_ROOT = '/runtime/state';

    expect(getConfigRoot()).toBe('/runtime/state/config');
    expect(getDefaultVaultRoot()).toBe('/runtime/state/sync');
    expect(getVaultRoot()).toBe('/runtime/state/sync');
    expect(getProfilesRoot()).toBe('/runtime/state/sync/_profiles');
    expect(getSyncRoot()).toBe('/runtime/state/sync');
    expect(getDurablePiAgentDir()).toBe('/runtime/state/sync/pi-agent');
    expect(getDurableSessionsDir()).toBe('/runtime/state/sync/pi-agent/sessions');
    expect(getDurableConversationAttentionDir()).toBe('/runtime/state/sync/pi-agent/state/conversation-attention');
    expect(getDurableProfilesDir()).toBe('/runtime/state/sync/_profiles');
    expect(getDurableSettingsDir()).toBe('/runtime/state/sync/settings');
    expect(getDurableModelsDir()).toBe('/runtime/state/sync/models');
    expect(getDurableSkillsDir()).toBe('/runtime/state/sync/_skills');
    expect(getDurableNodesDir()).toBe('/runtime/state/sync/nodes');
    expect(getDurableNotesDir()).toBe('/runtime/state/sync/notes');
    expect(getDurableMemoryDir()).toBe('/runtime/state/sync/notes');
    expect(getDurableTasksDir()).toBe('/runtime/state/sync/_tasks');
    expect(getDurableProjectsDir()).toBe('/runtime/state/sync/projects');
    expect(getLocalProfileDir()).toBe('/runtime/state/config/local');
  });

  it('honors explicit overrides', () => {
    process.env.PERSONAL_AGENT_CONFIG_ROOT = '/custom/config';
    process.env.PERSONAL_AGENT_PROFILES_ROOT = '/custom/profiles';
    process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR = '/custom/local';
    process.env.PERSONAL_AGENT_VAULT_ROOT = '/custom/vault';

    expect(getConfigRoot()).toBe('/custom/config');
    expect(getVaultRoot()).toBe('/custom/vault');
    expect(getProfilesRoot()).toBe('/custom/profiles');
    expect(getDurableProfilesDir()).toBe('/custom/vault/_profiles');
    expect(getDurableSkillsDir()).toBe('/custom/vault/_skills');
    expect(getDurableNotesDir()).toBe('/custom/vault/notes');
    expect(getDurableProjectsDir()).toBe('/custom/vault/projects');
    expect(getLocalProfileDir()).toBe('/custom/local');
  });

  it('falls back to legacy non-underscored durable directories when underscored ones are absent', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'personal-agent-state-'));
    mkdirSync(join(stateRoot, 'sync', 'profiles'), { recursive: true });
    mkdirSync(join(stateRoot, 'sync', 'skills'), { recursive: true });
    mkdirSync(join(stateRoot, 'sync', 'tasks'), { recursive: true });

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(getProfilesRoot()).toBe(join(stateRoot, 'sync', 'profiles'));
    expect(getDurableProfilesDir()).toBe(join(stateRoot, 'sync', 'profiles'));
    expect(getDurableProfileDir('default')).toBe(join(stateRoot, 'sync', 'profiles', 'default'));
    expect(getDurableSkillsDir()).toBe(join(stateRoot, 'sync', 'skills'));
    expect(getDurableTasksDir()).toBe(join(stateRoot, 'sync', 'tasks'));

    rmSync(stateRoot, { recursive: true, force: true });
  });

  it('expands ~ in path overrides', () => {
    process.env.PERSONAL_AGENT_CONFIG_ROOT = '~/pa-config';
    process.env.PERSONAL_AGENT_VAULT_ROOT = '~/Documents/personal-agent';

    expect(getConfigRoot()).toBe(join(homedir(), 'pa-config'));
    expect(getVaultRoot()).toBe(join(homedir(), 'Documents', 'personal-agent'));
  });
});

describe('resolveStatePaths', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
    delete process.env.PERSONAL_AGENT_AUTH_PATH;
    delete process.env.PERSONAL_AGENT_SESSION_PATH;
    delete process.env.PERSONAL_AGENT_CACHE_PATH;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default paths when no env vars set', () => {
    const paths = resolveStatePaths();
    const root = getDefaultStateRoot();

    expect(paths.root).toBe(root);
    expect(paths.auth).toBe(join(root, 'auth'));
    expect(paths.session).toBe(join(root, 'session'));
    expect(paths.cache).toBe(join(root, 'cache'));
  });

  it('should use PERSONAL_AGENT_STATE_ROOT for base path', () => {
    process.env.PERSONAL_AGENT_STATE_ROOT = '/runtime/state';
    const paths = resolveStatePaths();

    expect(paths.root).toBe('/runtime/state');
    expect(paths.auth).toBe('/runtime/state/auth');
    expect(paths.session).toBe('/runtime/state/session');
    expect(paths.cache).toBe('/runtime/state/cache');
  });

  it('should allow individual path overrides', () => {
    process.env.PERSONAL_AGENT_AUTH_PATH = '/secure/auth';
    process.env.PERSONAL_AGENT_SESSION_PATH = '/tmp/sessions';
    process.env.PERSONAL_AGENT_CACHE_PATH = '/var/cache/pa';

    const paths = resolveStatePaths();

    expect(paths.auth).toBe('/secure/auth');
    expect(paths.session).toBe('/tmp/sessions');
    expect(paths.cache).toBe('/var/cache/pa');
  });

  it('should combine root override with individual overrides', () => {
    process.env.PERSONAL_AGENT_STATE_ROOT = '/runtime/state';
    process.env.PERSONAL_AGENT_AUTH_PATH = '/secure/auth';

    const paths = resolveStatePaths();

    expect(paths.root).toBe('/runtime/state');
    expect(paths.auth).toBe('/secure/auth');
    expect(paths.session).toBe('/runtime/state/session');
    expect(paths.cache).toBe('/runtime/state/cache');
  });
});

describe('isPathInRepo', () => {
  it('should return true for paths inside repo', () => {
    const repoRoot = '/home/user/project';
    expect(isPathInRepo('/home/user/project', repoRoot)).toBe(true);
    expect(isPathInRepo('/home/user/project/src', repoRoot)).toBe(true);
    expect(isPathInRepo('/home/user/project/.git', repoRoot)).toBe(true);
    expect(isPathInRepo('/home/user/project/data/cache', repoRoot)).toBe(true);
  });

  it('should return false for paths outside repo', () => {
    const repoRoot = '/home/user/project';
    expect(isPathInRepo('/home/user', repoRoot)).toBe(false);
    expect(isPathInRepo('/home/user/other-project', repoRoot)).toBe(false);
    expect(isPathInRepo('/tmp/cache', repoRoot)).toBe(false);
    expect(isPathInRepo('/var/lib/data', repoRoot)).toBe(false);
  });

  it('should handle paths with trailing slashes', () => {
    const repoRoot = '/home/user/project';
    expect(isPathInRepo('/home/user/project/', repoRoot)).toBe(true);
    expect(isPathInRepo('/home/user/project/src/', repoRoot)).toBe(true);
  });

  it('should handle Windows-style paths', () => {
    const repoRoot = 'C:\\Users\\project';
    expect(isPathInRepo('C:\\Users\\project\\cache', repoRoot)).toBe(true);
    expect(isPathInRepo('D:\\other', repoRoot)).toBe(false);
  });

  it('should handle sibling directories correctly', () => {
    const repoRoot = '/home/user/project';
    expect(isPathInRepo('/home/user/project-data', repoRoot)).toBe(false);
    expect(isPathInRepo('/home/user/project_backup', repoRoot)).toBe(false);
  });

  it('canonicalizes dot segments before comparison', () => {
    const repoRoot = '/home/user/project';
    expect(isPathInRepo('/home/user/project/../outside', repoRoot)).toBe(false);
    expect(isPathInRepo('/home/user/project/../project/cache', repoRoot)).toBe(true);
  });

  it('resolves symlink targets before comparison', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'pa-paths-symlink-'));

    try {
      const repoRoot = join(tempRoot, 'repo');
      const symlinkPath = join(tempRoot, 'repo-link');

      mkdirSync(repoRoot, { recursive: true });
      symlinkSync(repoRoot, symlinkPath);

      expect(isPathInRepo(join(symlinkPath, 'state'), repoRoot)).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('validateStatePathsOutsideRepo', () => {
  it('should not throw when all paths are outside repo', () => {
    const paths: RuntimeStatePaths = {
      root: '/runtime/state',
      auth: '/runtime/state/auth',
      session: '/runtime/state/session',
      cache: '/runtime/state/cache',
    };

    expect(() => validateStatePathsOutsideRepo(paths, '/home/user/project')).not.toThrow();
  });

  it('should throw when root path is in repo', () => {
    const paths: RuntimeStatePaths = {
      root: '/home/user/project/.state',
      auth: '/tmp/auth',
      session: '/tmp/session',
      cache: '/tmp/cache',
    };

    expect(() => validateStatePathsOutsideRepo(paths, '/home/user/project')).toThrow('State root');
  });

  it('should throw when auth path is in repo', () => {
    const paths: RuntimeStatePaths = {
      root: '/home/user/project/.state',
      auth: '/home/user/project/.state/auth',
      session: '/tmp/session',
      cache: '/tmp/cache',
    };

    expect(() => validateStatePathsOutsideRepo(paths, '/home/user/project')).toThrow('Auth path');
  });

  it('should throw when session path is in repo', () => {
    const paths: RuntimeStatePaths = {
      root: '/tmp/state',
      auth: '/tmp/auth',
      session: '/home/user/project/.sessions',
      cache: '/tmp/cache',
    };

    expect(() => validateStatePathsOutsideRepo(paths, '/home/user/project')).toThrow('Session path');
  });

  it('should throw when cache path is in repo', () => {
    const paths: RuntimeStatePaths = {
      root: '/tmp/state',
      auth: '/tmp/auth',
      session: '/tmp/session',
      cache: '/home/user/project/node_modules/.cache',
    };

    expect(() => validateStatePathsOutsideRepo(paths, '/home/user/project')).toThrow('Cache path');
  });

  it('should report all violations in error message', () => {
    const paths: RuntimeStatePaths = {
      root: '/home/user/project/state',
      auth: '/home/user/project/state/auth',
      session: '/home/user/project/state/session',
      cache: '/home/user/project/state/cache',
    };

    let error: Error | undefined;
    try {
      validateStatePathsOutsideRepo(paths, '/home/user/project');
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain('State root');
    expect(error!.message).toContain('Auth path');
    expect(error!.message).toContain('Session path');
    expect(error!.message).toContain('Cache path');
    expect(error!.message).toContain('PERSONAL_AGENT_STATE_ROOT');
  });
});
