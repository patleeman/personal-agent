import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPiResourceArgs,
  listProfiles,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveResourceProfile,
} from './index.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTempProfilesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-profiles-'));
  const profilesRoot = join(root, 'sync', 'profiles');
  mkdirSync(profilesRoot, { recursive: true });
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(root, 'sync');
  tempDirs.push(root);
  return profilesRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resources negative tests', () => {
  describe('resolveResourceProfile error cases', () => {
    it('throws on invalid profile name with path traversal', () => {
      const repo = createTempDir('personal-agent-resources-');
      expect(() => resolveResourceProfile('../../../etc/passwd', { repoRoot: repo })).toThrow('Invalid profile name');
    });

    it('resolves empty profile names as shared when shared defaults exist', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('', { repoRoot: repo, profilesRoot });
      expect(resolved.name).toBe('shared');
    });

    it('resolves non-existent profile names to the shared profile', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('nonexistent', { repoRoot: repo, profilesRoot });
      expect(resolved.name).toBe('shared');
    });

    it('handles profile with no durable resources but local overlay', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      const local = createTempDir('personal-agent-local-');
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
      writeFile(join(local, 'agent/AGENTS.md'), '# Local\n');

      const resolved = resolveResourceProfile('shared', {
        repoRoot: repo,
        profilesRoot,
        localProfileDir: local,
      });

      expect(resolved.layers.map((layer) => layer.name)).toEqual(['defaults', 'durable', 'local']);
    });
  });

  describe('mergeJsonFiles error cases', () => {
    it('throws on non-existent file', () => {
      const repo = createTempDir('personal-agent-resources-');
      const nonExistentFile = join(repo, 'nonexistent.json');

      expect(() => mergeJsonFiles([nonExistentFile])).toThrow();
    });

    it('throws on malformed JSON', () => {
      const repo = createTempDir('personal-agent-resources-');
      const file = join(repo, 'malformed.json');
      writeFile(file, '{"broken":');

      expect(() => mergeJsonFiles([file])).toThrow();
    });

    it('handles empty array of files', () => {
      expect(mergeJsonFiles([])).toEqual({});
    });
  });

  describe('materializeProfileToAgentDir edge cases', () => {
    it('writes APPEND_SYSTEM with durable vault guidance even when no other system append content exists', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      const runtime = createTempDir('personal-agent-runtime-');
      const syncRoot = join(profilesRoot, '..');

      process.env.PERSONAL_AGENT_VAULT_ROOT = syncRoot;
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', {
        repoRoot: repo,
        profilesRoot,
        localProfileDir: join(repo, '.local-profile'),
      });
      materializeProfileToAgentDir(resolved, runtime);

      const appendSystemPath = join(runtime, 'APPEND_SYSTEM.md');
      expect(existsSync(appendSystemPath)).toBe(true);
      expect(readFileSync(appendSystemPath, 'utf-8')).toContain(`The canonical durable knowledge vault root is: ${syncRoot}`);
    });

    it('handles runtime directory that does not exist', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      const runtime = join(createTempDir('personal-agent-parent-'), 'nested', 'runtime');

      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', {
        repoRoot: repo,
        profilesRoot,
        localProfileDir: join(repo, '.local-profile'),
      });
      const result = materializeProfileToAgentDir(resolved, runtime);

      expect(result.writtenFiles.length).toBeGreaterThan(0);
    });
  });

  describe('listProfiles edge cases', () => {
    it('always includes the shared profile', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();

      const profiles = listProfiles({ repoRoot: repo, profilesRoot });
      expect(profiles).toEqual(['shared']);
    });

    it('ignores legacy profile directories', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      mkdirSync(join(profilesRoot, 'incomplete'), { recursive: true });

      const profiles = listProfiles({ repoRoot: repo, profilesRoot });
      expect(profiles).toEqual(['shared']);
    });

    it('does not list legacy profile directories with special characters', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      mkdirSync(join(profilesRoot, 'test-profile_v2'), { recursive: true });

      const profiles = listProfiles({ repoRoot: repo, profilesRoot });
      expect(profiles).toEqual(['shared']);
    });
  });

  describe('buildPiResourceArgs edge cases', () => {
    it('handles profile with no resource directories', () => {
      const repo = createTempDir('personal-agent-resources-');
      const profilesRoot = createTempProfilesRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', {
        repoRoot: repo,
        profilesRoot,
        localProfileDir: join(repo, '.local-profile'),
      });
      const emptyResolved = {
        ...resolved,
        extensionDirs: [],
        skillDirs: [],
        promptDirs: [],
        themeDirs: [],
      };

      const args = buildPiResourceArgs(emptyResolved);
      expect(args).toContain('--no-extensions');
    });
  });
});
