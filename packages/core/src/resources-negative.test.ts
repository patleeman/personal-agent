import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPiResourceArgs,
  listRuntimeScopes,
  materializeRuntimeResourcesToAgentDir,
  mergeJsonFiles,
  resolveRuntimeResources,
} from './index.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTempRuntimeConfigRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-config-'));
  const runtimeConfigRoot = join(root, 'sync', 'profiles');
  mkdirSync(runtimeConfigRoot, { recursive: true });
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(root, 'sync');
  tempDirs.push(root);
  return runtimeConfigRoot;
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
  describe('resolveRuntimeResources error cases', () => {
    it('throws on invalid runtime scope name with path traversal', () => {
      const repo = createTempDir('personal-agent-resources-');
      expect(() => resolveRuntimeResources('../../../etc/passwd', { repoRoot: repo })).toThrow('Invalid runtime scope name');
    });

    it('resolves empty runtime scope names as shared when shared defaults exist', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveRuntimeResources('', { repoRoot: repo, runtimeConfigRoot });
      expect(resolved.name).toBe('shared');
    });

    it('resolves non-existent runtime scope names to shared', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveRuntimeResources('nonexistent', { repoRoot: repo, runtimeConfigRoot });
      expect(resolved.name).toBe('shared');
    });

    it('handles a runtime scope with no durable resources but local overlay', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      const local = createTempDir('personal-agent-local-');
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
      writeFile(join(local, 'agent/AGENTS.md'), '# Local\n');

      const resolved = resolveRuntimeResources('shared', {
        repoRoot: repo,
        runtimeConfigRoot,
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

  describe('materializeRuntimeResourcesToAgentDir edge cases', () => {
    it('writes APPEND_SYSTEM with durable vault guidance even when no other system append content exists', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      const runtime = createTempDir('personal-agent-runtime-');
      const syncRoot = join(runtimeConfigRoot, '..');

      process.env.PERSONAL_AGENT_VAULT_ROOT = syncRoot;
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveRuntimeResources('shared', {
        repoRoot: repo,
        runtimeConfigRoot,
        localProfileDir: join(repo, '.local-profile'),
      });
      materializeRuntimeResourcesToAgentDir(resolved, runtime);

      const appendSystemPath = join(runtime, 'APPEND_SYSTEM.md');
      expect(existsSync(appendSystemPath)).toBe(true);
      expect(readFileSync(appendSystemPath, 'utf-8')).toContain(`Vault root: ${syncRoot}`);
    });

    it('handles runtime directory that does not exist', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      const runtime = join(createTempDir('personal-agent-parent-'), 'nested', 'runtime');

      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveRuntimeResources('shared', {
        repoRoot: repo,
        runtimeConfigRoot,
        localProfileDir: join(repo, '.local-profile'),
      });
      const result = materializeRuntimeResourcesToAgentDir(resolved, runtime);

      expect(result.writtenFiles.length).toBeGreaterThan(0);
    });
  });

  describe('listRuntimeScopes edge cases', () => {
    it('always includes the shared runtime scope', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();

      const profiles = listRuntimeScopes({ repoRoot: repo, runtimeConfigRoot });
      expect(profiles).toEqual(['shared']);
    });

    it('ignores legacy runtime scope directories', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      mkdirSync(join(runtimeConfigRoot, 'incomplete'), { recursive: true });

      const profiles = listRuntimeScopes({ repoRoot: repo, runtimeConfigRoot });
      expect(profiles).toEqual(['shared']);
    });

    it('does not list legacy runtime scope directories with special characters', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      mkdirSync(join(runtimeConfigRoot, 'test-profile_v2'), { recursive: true });

      const profiles = listRuntimeScopes({ repoRoot: repo, runtimeConfigRoot });
      expect(profiles).toEqual(['shared']);
    });
  });

  describe('buildPiResourceArgs edge cases', () => {
    it('handles a runtime scope with no resource directories', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtimeConfigRoot = createTempRuntimeConfigRoot();
      writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveRuntimeResources('shared', {
        repoRoot: repo,
        runtimeConfigRoot,
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
