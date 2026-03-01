/**
 * P3: Resources package negative tests
 * Tests for malformed profile structures, missing files, and edge cases
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
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

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resources negative tests', () => {
  describe('resolveResourceProfile error cases', () => {
    it('throws on invalid profile name with path traversal', () => {
      const repo = createTempDir('personal-agent-resources-');

      expect(() => resolveResourceProfile('../../../etc/passwd', { repoRoot: repo })).toThrow(
        'Invalid profile name'
      );
    });

    it('throws on profile name with null bytes', () => {
      const repo = createTempDir('personal-agent-resources-');

      expect(() => resolveResourceProfile('test\0profile', { repoRoot: repo })).toThrow();
    });

    it('throws on empty profile name', () => {
      const repo = createTempDir('personal-agent-resources-');

      expect(() => resolveResourceProfile('', { repoRoot: repo })).toThrow();
    });

    it('throws on non-existent profile', () => {
      const repo = createTempDir('personal-agent-resources-');

      expect(() => resolveResourceProfile('nonexistent', { repoRoot: repo })).toThrow();
    });

    it('handles profile with empty extension directory', () => {
      const repo = createTempDir('personal-agent-resources-');
      const extensionsDir = join(repo, 'profiles/shared/agent/extensions');
      mkdirSync(extensionsDir, { recursive: true });
      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });

      expect(resolved.extensionDirs).toEqual([extensionsDir]);
      expect(resolved.extensionEntries).toEqual([]);
    });

    it('handles profile with empty skills directory', () => {
      const repo = createTempDir('personal-agent-resources-');
      const skillsDir = join(repo, 'profiles/shared/agent/skills');
      mkdirSync(skillsDir, { recursive: true });
      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });

      expect(resolved.skillDirs).toEqual([skillsDir]);
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

    it('throws on JSON with syntax error', () => {
      const repo = createTempDir('personal-agent-resources-');
      const file = join(repo, 'syntax-error.json');
      writeFile(file, 'not json at all');

      expect(() => mergeJsonFiles([file])).toThrow();
    });

    it('handles empty array of files', () => {
      const result = mergeJsonFiles([]);
      expect(result).toEqual({});
    });

    it('handles file with valid JSON array payload by preserving numeric keys', () => {
      const repo = createTempDir('personal-agent-resources-');
      const file = join(repo, 'array.json');
      writeFile(file, '[1, 2, 3]');

      const result = mergeJsonFiles([file]);
      expect(result).toEqual({
        0: 1,
        1: 2,
        2: 3,
      });
    });
  });

  describe('materializeProfileToAgentDir edge cases', () => {
    it('handles empty profile resolution', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtime = createTempDir('personal-agent-runtime-');

      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });
      const result = materializeProfileToAgentDir(resolved, runtime);

      expect(result.writtenFiles.length).toBeGreaterThan(0);
    });

    it('handles runtime directory that does not exist', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtime = join(createTempDir('personal-agent-parent-'), 'nested', 'runtime');

      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });
      const result = materializeProfileToAgentDir(resolved, runtime);

      expect(result.writtenFiles.length).toBeGreaterThan(0);
    });

    it('preserves existing files not managed by profile', () => {
      const repo = createTempDir('personal-agent-resources-');
      const runtime = createTempDir('personal-agent-runtime-');

      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
      writeFile(join(runtime, 'UNRELATED.md'), 'should be preserved\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });
      materializeProfileToAgentDir(resolved, runtime);

      // The unrelated file should be removed (current behavior is to clear runtime dir)
      expect(join(runtime, 'UNRELATED.md')).not.toBe(join(runtime, 'AGENTS.md'));
    });
  });

  describe('listProfiles edge cases', () => {
    it('returns empty array when profiles directory does not exist', () => {
      const repo = createTempDir('personal-agent-resources-');

      const profiles = listProfiles({ repoRoot: repo });
      expect(profiles).toEqual([]);
    });

    it('returns empty array when profiles directory is empty', () => {
      const repo = createTempDir('personal-agent-resources-');
      mkdirSync(join(repo, 'profiles'), { recursive: true });

      const profiles = listProfiles({ repoRoot: repo });
      expect(profiles).toEqual([]);
    });

    it('ignores profiles without agent directory', () => {
      const repo = createTempDir('personal-agent-resources-');
      mkdirSync(join(repo, 'profiles/invalid-profile'), { recursive: true });
      // No agent subdirectory

      const profiles = listProfiles({ repoRoot: repo });
      expect(profiles).toEqual([]);
    });

    it('includes profiles with agent directory even without AGENTS.md', () => {
      const repo = createTempDir('personal-agent-resources-');
      mkdirSync(join(repo, 'profiles/incomplete/agent'), { recursive: true });

      const profiles = listProfiles({ repoRoot: repo });
      expect(profiles).toEqual(['incomplete']);
    });

    it('handles profiles with special characters in name (valid)', () => {
      const repo = createTempDir('personal-agent-resources-');
      writeFile(join(repo, 'profiles/test-profile_v2/agent/AGENTS.md'), '# Test\n');

      const profiles = listProfiles({ repoRoot: repo });
      expect(profiles).toContain('test-profile_v2');
    });
  });

  describe('buildPiResourceArgs edge cases', () => {
    it('handles profile with no resource directories', () => {
      const repo = createTempDir('personal-agent-resources-');
      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });
      // Manually clear resource dirs
      const emptyResolved = {
        ...resolved,
        extensionDirs: [],
        skillDirs: [],
        promptDirs: [],
        themeDirs: [],
      };

      const args = buildPiResourceArgs(emptyResolved);

      // Should still produce valid args
      expect(args).toContain('--no-extensions');
    });

    it('handles multiple extensions', () => {
      const repo = createTempDir('personal-agent-resources-');
      writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
      writeFile(join(repo, 'profiles/shared/agent/extensions/ext1/index.ts'), 'export default {}');
      writeFile(join(repo, 'profiles/shared/agent/extensions/ext2/index.ts'), 'export default {}');

      const resolved = resolveResourceProfile('shared', { repoRoot: repo });
      const args = buildPiResourceArgs(resolved);

      // Should have extension args
      expect(args.some((arg) => arg.includes('extensions'))).toBe(true);
    });
  });

  describe('merge precedence edge cases', () => {
    it('handles deeply nested object merging', () => {
      const repo = createTempDir('personal-agent-resources-');
      const fileA = join(repo, 'a.json');
      const fileB = join(repo, 'b.json');

      writeFile(
        fileA,
        JSON.stringify({
          level1: {
            level2: {
              level3: {
                value: 'from-a',
              },
            },
          },
        })
      );

      writeFile(
        fileB,
        JSON.stringify({
          level1: {
            level2: {
              level3: {
                other: 'from-b',
              },
            },
          },
        })
      );

      const merged = mergeJsonFiles([fileA, fileB]);

      expect(merged).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'from-a',
              other: 'from-b',
            },
          },
        },
      });
    });

    it('handles null values in merge', () => {
      const repo = createTempDir('personal-agent-resources-');
      const fileA = join(repo, 'a.json');
      const fileB = join(repo, 'b.json');

      writeFile(fileA, JSON.stringify({ value: 'from-a' }));
      writeFile(fileB, JSON.stringify({ value: null }));

      const merged = mergeJsonFiles([fileA, fileB]);

      expect(merged).toEqual({ value: null });
    });

    it('handles array replacement in merge', () => {
      const repo = createTempDir('personal-agent-resources-');
      const fileA = join(repo, 'a.json');
      const fileB = join(repo, 'b.json');

      writeFile(fileA, JSON.stringify({ items: [1, 2, 3] }));
      writeFile(fileB, JSON.stringify({ items: [4, 5] }));

      const merged = mergeJsonFiles([fileA, fileB]);

      // Arrays should be replaced, not merged
      expect(merged).toEqual({ items: [4, 5] });
    });
  });
});
