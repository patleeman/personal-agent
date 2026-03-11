import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPiResourceArgs,
  getExtensionDependencyDirs,
  listProfiles,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveResourceProfile,
} from './index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-resources-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('resources profile loader', () => {
  it('lists available profiles', () => {
    const repo = createTempRepo();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');

    const profiles = listProfiles({ repoRoot: repo });
    expect(profiles).toEqual(['datadog', 'shared']);
  });

  it('rejects invalid profile names', () => {
    const repo = createTempRepo();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    expect(() => resolveResourceProfile('../escape', { repoRoot: repo })).toThrow('Invalid profile name');
  });

  it('resolves layered profile with shared + overlay + local', () => {
    const repo = createTempRepo();
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ a: 1, nested: { one: true } }));

    writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');
    writeFile(join(repo, 'profiles/datadog/agent/settings.json'), JSON.stringify({ nested: { two: true } }));

    writeFile(join(local, 'agent/AGENTS.md'), '# Local\n');
    writeFile(join(local, 'agent/settings.json'), JSON.stringify({ localOnly: true }));

    const resolved = resolveResourceProfile('datadog', {
      repoRoot: repo,
      localProfileDir: local,
    });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog', 'local']);
    expect(resolved.extensionDirs.length).toBe(1);
    expect(resolved.settingsFiles.length).toBe(3);
    expect(resolved.agentsFiles.length).toBe(3);
  });

  it('ignores top-level extension test files', () => {
    const repo = createTempRepo();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.test.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.spec.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/nested/index.ts'), 'export default {}\n');

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });

    expect(resolved.extensionEntries).toEqual([
      join(repo, 'profiles/shared/agent/extensions/nested/index.ts'),
      join(repo, 'profiles/shared/agent/extensions/sample.ts'),
    ]);
  });

  it('discovers extension dependency directories for nested extension packages', () => {
    const repo = createTempRepo();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/basic/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/basic/package.json'), JSON.stringify({
      name: 'basic',
      version: '1.0.0',
    }));

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });
    const dependencyDirs = getExtensionDependencyDirs(resolved);

    expect(dependencyDirs).toEqual([
      join(repo, 'profiles/shared/agent/extensions/basic'),
    ]);
  });

  it('layers shared and profile skills for datadog even without overlay AGENTS.md', () => {
    const repo = createTempRepo();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/skills/shared-skill/SKILL.md'), '# Shared Skill\n');
    writeFile(join(repo, 'profiles/datadog/agent/skills/dd-skill/SKILL.md'), '# Datadog Skill\n');

    const resolved = resolveResourceProfile('datadog', { repoRoot: repo });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(resolved.agentsFiles).toEqual([join(repo, 'profiles/shared/agent/AGENTS.md')]);
    expect(resolved.skillDirs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(repo, 'profiles/datadog/agent/skills'),
    ]);

    const args = buildPiResourceArgs(resolved);
    const skillArgs = args
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === '--skill')
      .map((entry) => args[entry.index + 1]);

    expect(skillArgs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(repo, 'profiles/datadog/agent/skills'),
    ]);
  });

  it('merges json files in layer order', () => {
    const repo = createTempRepo();
    const fileA = join(repo, 'a.json');
    const fileB = join(repo, 'b.json');

    writeFile(fileA, JSON.stringify({ one: 1, nested: { a: true }, array: [1, 2] }));
    writeFile(fileB, JSON.stringify({ two: 2, nested: { b: true }, array: [3] }));

    const merged = mergeJsonFiles([fileA, fileB]);
    expect(merged).toEqual({
      one: 1,
      two: 2,
      nested: { a: true, b: true },
      array: [3],
    });
  });

  it('blocks prototype-polluting keys during merge', () => {
    const repo = createTempRepo();
    const fileA = join(repo, 'a.json');
    const fileB = join(repo, 'b.json');

    writeFile(fileA, JSON.stringify({ safe: true }));
    writeFile(fileB, '{"__proto__":{"polluted":"yes"},"nested":{"constructor":{"bad":true},"ok":1}}');

    const merged = mergeJsonFiles([fileA, fileB]);

    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    expect((merged as Record<string, unknown>).safe).toBe(true);

    const nested = (merged as Record<string, unknown>).nested as Record<string, unknown>;
    expect(nested.ok).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(nested, 'constructor')).toBe(false);

    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  it('includes file path in JSON parse errors', () => {
    const repo = createTempRepo();
    const file = join(repo, 'broken.json');
    writeFile(file, '{"broken":');

    expect(() => mergeJsonFiles([file])).toThrow(`Failed to read JSON file ${file}`);
  });

  it('materializes merged files into runtime agent dir', () => {
    const repo = createTempRepo();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/APPEND_SYSTEM.md'), 'shared append\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(repo, 'profiles/shared/agent/models.json'), JSON.stringify({ providers: { a: {} } }));

    writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');
    writeFile(join(repo, 'profiles/datadog/agent/settings.json'), JSON.stringify({ datadog: true }));

    const resolved = resolveResourceProfile('datadog', { repoRoot: repo });
    const result = materializeProfileToAgentDir(resolved, runtime);

    expect(result.writtenFiles.length).toBeGreaterThan(0);
    expect(result.writtenFiles.some((path) => path.endsWith('/AGENTS.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/settings.json'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/models.json'))).toBe(true);
  });

  it('preserves runtime lastChangelogVersion over profile value', () => {
    const repo = createTempRepo();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(
      join(runtime, 'settings.json'),
      JSON.stringify({ lastChangelogVersion: '0.55.3', runtimeOnly: true }),
    );

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'profiles/shared/agent/settings.json'),
      JSON.stringify({ theme: 'cobalt2', lastChangelogVersion: '0.52.9' }),
    );

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });
    materializeProfileToAgentDir(resolved, runtime);

    const settings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(settings.lastChangelogVersion).toBe('0.55.3');
    expect(settings.theme).toBe('cobalt2');
    expect(settings.runtimeOnly).toBeUndefined();
  });

  it('drops profile-provided lastChangelogVersion when runtime value is missing', () => {
    const repo = createTempRepo();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'profiles/shared/agent/settings.json'),
      JSON.stringify({ theme: 'cobalt2', lastChangelogVersion: '0.52.9' }),
    );

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });
    materializeProfileToAgentDir(resolved, runtime);

    const settings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(settings, 'lastChangelogVersion')).toBe(false);
    expect(settings.theme).toBe('cobalt2');
  });

  it('removes stale runtime files when profile no longer provides them', () => {
    const repo = createTempRepo();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(runtime, 'SYSTEM.md'), 'stale system\n');

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });
    materializeProfileToAgentDir(resolved, runtime);

    expect(existsSync(join(runtime, 'SYSTEM.md'))).toBe(false);
  });

  it('builds pi args from resource directories', () => {
    const repo = createTempRepo();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/skills/test/SKILL.md'), '# Skill\n');
    writeFile(join(repo, 'profiles/shared/agent/prompts/review.md'), 'review\n');
    writeFile(join(repo, 'profiles/shared/agent/themes/theme.json'), '{}\n');

    const resolved = resolveResourceProfile('shared', { repoRoot: repo });
    const args = buildPiResourceArgs(resolved);

    expect(args).toContain('--no-extensions');
    expect(args).toContain('-e');
    expect(args).toContain('--skill');
    expect(args).toContain('--prompt-template');
    expect(args).toContain('--theme');
  });
});
