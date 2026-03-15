import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPiResourceArgs,
  getExtensionDependencyDirs,
  installPackageSource,
  listProfiles,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  readPackageSourceTargetState,
  resolveLocalProfileSettingsFilePath,
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

function createTempProfilesRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-profiles-'));
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
    const profilesRoot = createTempProfilesRoot();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'datadog/agent/AGENTS.md'), '# Datadog\n');

    const profiles = listProfiles({ repoRoot: repo, profilesRoot });
    expect(profiles).toEqual(['datadog', 'shared']);
  });

  it('rejects invalid profile names', () => {
    const repo = createTempRepo();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    expect(() => resolveResourceProfile('../escape', { repoRoot: repo })).toThrow('Invalid profile name');
  });

  it('resolves layered profile with shared + overlay + local', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ a: 1, nested: { one: true } }));

    writeFile(join(profilesRoot, 'datadog/agent/AGENTS.md'), '# Datadog\n');
    writeFile(join(profilesRoot, 'datadog/agent/settings.json'), JSON.stringify({ nested: { two: true } }));

    writeFile(join(local, 'agent/AGENTS.md'), '# Local\n');
    writeFile(join(local, 'agent/settings.json'), JSON.stringify({ localOnly: true }));

    const resolved = resolveResourceProfile('datadog', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: local,
    });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog', 'local']);
    expect(resolved.extensionDirs.length).toBe(1);
    expect(resolved.settingsFiles.length).toBe(3);
    expect(resolved.agentsFiles.length).toBe(3);
  });

  it('falls back to repo shared layer when mutable shared overlay has no shared resources', () => {
    const repo = createTempRepo();
    const profilesRoot = mkdtempSync(join(tmpdir(), 'personal-agent-profiles-'));
    tempDirs.push(profilesRoot);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ theme: 'cobalt2' }));
    writeFile(join(repo, 'profiles/shared/agent/skills/shared-skill/SKILL.md'), '# Shared skill\n');

    // Tasks-only shared overlays should not shadow canonical shared defaults.
    writeFile(join(profilesRoot, 'shared/agent/tasks/README.md'), '# tasks\n');
    writeFile(join(profilesRoot, 'assistant/agent/AGENTS.md'), '# Assistant\n');

    const resolved = resolveResourceProfile('assistant', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.layers[0]).toEqual({
      name: 'shared',
      agentDir: join(repo, 'profiles/shared/agent'),
    });
    expect(resolved.skillDirs).toContain(join(repo, 'profiles/shared/agent/skills'));
    expect(resolved.settingsFiles).toContain(join(repo, 'profiles/shared/agent/settings.json'));
  });

  it('ignores top-level extension test files', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.test.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/sample.spec.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/nested/index.ts'), 'export default {}\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.extensionEntries).toEqual([
      join(repo, 'profiles/shared/agent/extensions/nested/index.ts'),
      join(repo, 'profiles/shared/agent/extensions/sample.ts'),
    ]);
  });

  it('discovers extension dependency directories for nested extension packages', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/basic/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/basic/package.json'), JSON.stringify({
      name: 'basic',
      version: '1.0.0',
    }));

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    const dependencyDirs = getExtensionDependencyDirs(resolved);

    expect(dependencyDirs).toEqual([
      join(repo, 'profiles/shared/agent/extensions/basic'),
    ]);
  });

  it('layers shared and profile skills for datadog even without overlay AGENTS.md', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/skills/shared-skill/SKILL.md'), '# Shared Skill\n');
    writeFile(join(profilesRoot, 'datadog/agent/skills/dd-skill/SKILL.md'), '# Datadog Skill\n');

    const resolved = resolveResourceProfile('datadog', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(resolved.agentsFiles).toEqual([join(repo, 'profiles/shared/agent/AGENTS.md')]);
    expect(resolved.skillDirs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(profilesRoot, 'datadog/agent/skills'),
    ]);

    const args = buildPiResourceArgs(resolved);
    const skillArgs = args
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === '--skill')
      .map((entry) => args[entry.index + 1]);

    expect(skillArgs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(profilesRoot, 'datadog/agent/skills'),
    ]);
  });

  it('includes repo-provided internal skills alongside profile skills', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/skills/shared-skill/SKILL.md'), '# Shared Skill\n');
    writeFile(join(repo, 'skills/pa-project-hub/SKILL.md'), '# Internal Skill\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.skillDirs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(repo, 'skills'),
    ]);

    const args = buildPiResourceArgs(resolved);
    const skillArgs = args
      .map((value, index) => ({ value, index }))
      .filter((entry) => entry.value === '--skill')
      .map((entry) => args[entry.index + 1]);

    expect(skillArgs).toEqual([
      join(repo, 'profiles/shared/agent/skills'),
      join(repo, 'skills'),
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
    const profilesRoot = createTempProfilesRoot();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/APPEND_SYSTEM.md'), 'shared append\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(repo, 'profiles/shared/agent/models.json'), JSON.stringify({ providers: { a: {} } }));
    writeFile(join(repo, 'prompt-catalog/system/00-role.md'), 'catalog role\n');

    writeFile(join(profilesRoot, 'datadog/agent/AGENTS.md'), '# Datadog\n');
    writeFile(join(profilesRoot, 'datadog/agent/settings.json'), JSON.stringify({ datadog: true }));

    const resolved = resolveResourceProfile('datadog', { repoRoot: repo, profilesRoot });
    const result = materializeProfileToAgentDir(resolved, runtime);

    expect(result.writtenFiles.length).toBeGreaterThan(0);
    expect(result.writtenFiles.some((path) => path.endsWith('/AGENTS.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/APPEND_SYSTEM.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/settings.json'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/models.json'))).toBe(true);
    expect(readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8')).toContain('catalog role');
    expect(readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8')).toContain('shared append');
  });

  it('preserves runtime lastChangelogVersion over profile value', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
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

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    materializeProfileToAgentDir(resolved, runtime);

    const settings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(settings.lastChangelogVersion).toBe('0.55.3');
    expect(settings.theme).toBe('cobalt2');
    expect(settings.runtimeOnly).toBeUndefined();
  });

  it('installs package sources into the selected target settings file', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'assistant/agent/AGENTS.md'), '# Assistant\n');
    writeFile(
      join(profilesRoot, 'assistant/agent/settings.json'),
      JSON.stringify({ packages: ['/existing-package'] }),
    );

    const profileInstall = installPackageSource({
      repoRoot: repo,
      profilesRoot,
      localProfileDir: local,
      profileName: 'assistant',
      source: 'https://github.com/davebcn87/pi-autoresearch',
      target: 'profile',
      sourceBaseDir: repo,
    });

    expect(profileInstall.installed).toBe(true);
    expect(profileInstall.alreadyPresent).toBe(false);
    expect(profileInstall.settingsPath).toBe(join(profilesRoot, 'assistant/agent/settings.json'));

    const profileState = readPackageSourceTargetState('profile', 'assistant', { repoRoot: repo, profilesRoot, localProfileDir: local });
    expect(profileState.packages).toEqual([
      { source: '/existing-package', filtered: false },
      { source: 'https://github.com/davebcn87/pi-autoresearch', filtered: false },
    ]);

    const localInstall = installPackageSource({
      repoRoot: repo,
      localProfileDir: local,
      source: './local-package',
      target: 'local',
      sourceBaseDir: repo,
    });

    expect(localInstall.installed).toBe(true);
    expect(localInstall.settingsPath).toBe(resolveLocalProfileSettingsFilePath({ localProfileDir: local }));

    const localState = readPackageSourceTargetState('local', { repoRoot: repo, profilesRoot, localProfileDir: local });
    expect(localState.packages).toEqual([
      { source: join(repo, 'local-package'), filtered: false },
    ]);
  });

  it('treats filtered package entries as already configured when sources match', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'assistant/agent/AGENTS.md'), '# Assistant\n');
    writeFile(
      join(profilesRoot, 'assistant/agent/settings.json'),
      JSON.stringify({
        packages: [
          {
            source: 'https://github.com/davebcn87/pi-autoresearch',
            skills: [],
          },
        ],
      }),
    );

    const result = installPackageSource({
      repoRoot: repo,
      profilesRoot,
      profileName: 'assistant',
      source: 'https://github.com/davebcn87/pi-autoresearch',
      target: 'profile',
      sourceBaseDir: repo,
    });

    expect(result.installed).toBe(false);
    expect(result.alreadyPresent).toBe(true);

    const settings = JSON.parse(
      readFileSync(join(profilesRoot, 'assistant/agent/settings.json'), 'utf-8'),
    ) as { packages: Array<Record<string, unknown>> };
    expect(settings.packages).toHaveLength(1);
  });

  it('drops profile-provided lastChangelogVersion when runtime value is missing', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'profiles/shared/agent/settings.json'),
      JSON.stringify({ theme: 'cobalt2', lastChangelogVersion: '0.52.9' }),
    );

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    materializeProfileToAgentDir(resolved, runtime);

    const settings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(settings, 'lastChangelogVersion')).toBe(false);
    expect(settings.theme).toBe('cobalt2');
  });

  it('removes stale runtime files when profile no longer provides them', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(runtime, 'SYSTEM.md'), 'stale system\n');

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    materializeProfileToAgentDir(resolved, runtime);

    expect(existsSync(join(runtime, 'SYSTEM.md'))).toBe(false);
  });

  it('builds pi args from resource directories', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'profiles/shared/agent/extensions/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'profiles/shared/agent/skills/test/SKILL.md'), '# Skill\n');
    writeFile(join(repo, 'profiles/shared/agent/prompts/review.md'), 'review\n');
    writeFile(join(repo, 'profiles/shared/agent/themes/theme.json'), '{}\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    const args = buildPiResourceArgs(resolved);

    expect(args).toContain('--no-extensions');
    expect(args).toContain('-e');
    expect(args).toContain('--skill');
    expect(args).toContain('--prompt-template');
    expect(args).toContain('--theme');
  });
});
