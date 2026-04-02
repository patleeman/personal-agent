import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-profiles-'));
  const profilesRoot = join(root, 'sync', 'profiles');
  mkdirSync(profilesRoot, { recursive: true });
  tempDirs.push(root);
  return profilesRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('resources profile loader', () => {
  it('lists available profiles from durable profile definitions', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'datadog.json'), '{"title":"Datadog"}\n');

    const profiles = listProfiles({ repoRoot: repo, profilesRoot });
    expect(profiles).toEqual(['datadog', 'shared']);
  });

  it('resolves durable resources plus local overlays', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'defaults/agent/settings.json'), JSON.stringify({ a: 1, nested: { one: true } }));
    writeFile(join(repo, 'extensions/index.ts'), 'export default {}\n');
    writeFile(join(profilesRoot, 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(profilesRoot, 'datadog', 'agent', 'AGENTS.md'), '# Durable datadog\n');
    writeFile(join(syncRoot, 'settings', 'global.json'), JSON.stringify({ nested: { two: true } }));
    writeFile(join(syncRoot, 'settings', 'datadog.json'), JSON.stringify({ datadog: true }));
    writeFile(join(syncRoot, 'nodes', 'shared-skill', 'INDEX.md'), '---\nid: shared-skill\ntitle: Shared skill\nsummary: Shared\ndescription: Shared\ntags:\n  - type:skill\n  - profile:shared\n---\n');
    writeFile(join(syncRoot, 'nodes', 'datadog-skill', 'INDEX.md'), '---\nid: datadog-skill\ntitle: Datadog skill\nsummary: Datadog\ndescription: Datadog\ntags:\n  - type:skill\n  - profile:datadog\n---\n');
    writeFile(join(local, 'agent/AGENTS.md'), '# Local\n');
    writeFile(join(local, 'agent/settings.json'), JSON.stringify({ localOnly: true }));

    const resolved = resolveResourceProfile('datadog', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: local,
    });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['defaults', 'durable', 'local']);
    expect(resolved.agentsFiles).toEqual([
      join(repo, 'defaults/agent/AGENTS.md'),
      join(profilesRoot, 'datadog', 'agent', 'AGENTS.md'),
      join(local, 'agent', 'AGENTS.md'),
    ]);
    expect(resolved.settingsFiles).toEqual([
      join(repo, 'defaults/agent/settings.json'),
      join(syncRoot, 'settings', 'datadog.json'),
      join(syncRoot, 'settings', 'global.json'),
      join(local, 'agent', 'settings.json'),
    ]);
    expect(resolved.skillDirs).toEqual([
      join(syncRoot, 'nodes', 'datadog-skill'),
      join(syncRoot, 'nodes', 'shared-skill'),
    ]);
    expect(resolved.extensionEntries).toEqual([join(repo, 'extensions', 'index.ts')]);
  });

  it('includes repo-provided internal extensions and themes', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'extensions/basic/index.ts'), 'export default {}\n');
    writeFile(join(repo, 'extensions/basic/package.json'), JSON.stringify({ name: 'basic', version: '1.0.0' }));
    writeFile(join(repo, 'themes/cobalt2.json'), '{}\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.extensionDirs).toEqual([join(repo, 'extensions')]);
    expect(resolved.extensionEntries).toEqual([join(repo, 'extensions/basic/index.ts')]);
    expect(resolved.themeDirs).toEqual([join(repo, 'themes')]);
    expect(resolved.themeEntries).toEqual([join(repo, 'themes/cobalt2.json')]);
    expect(getExtensionDependencyDirs(resolved)).toEqual([join(repo, 'extensions/basic')]);
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

  it('materializes merged files into runtime agent dir', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'defaults/agent/APPEND_SYSTEM.md'), 'shared append\n');
    writeFile(join(repo, 'defaults/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(repo, 'defaults/agent/models.json'), JSON.stringify({ providers: { a: {} } }));
    writeFile(join(repo, 'prompt-catalog/system/00-role.md'), 'catalog role\n');
    writeFile(join(profilesRoot, 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(profilesRoot, 'datadog', 'agent', 'AGENTS.md'), '# Datadog\n');
    writeFile(join(syncRoot, 'settings', 'datadog.json'), JSON.stringify({
      datadog: true,
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'high',
    }));
    writeFile(join(syncRoot, 'nodes', 'checkpoint', 'INDEX.md'), `---
id: checkpoint
title: Checkpoint
summary: Commit and push the agent's current work.
description: Commit and push the agent's current work.
tags:
  - type:skill
---`);

    const resolved = resolveResourceProfile('datadog', { repoRoot: repo, profilesRoot });
    const result = materializeProfileToAgentDir(resolved, runtime);
    const runtimeSettings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const runtimePrompt = readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8');

    expect(result.writtenFiles.some((path) => path.endsWith('/AGENTS.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/APPEND_SYSTEM.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/settings.json'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/models.json'))).toBe(true);
    expect(runtimePrompt).toContain('catalog role');
    expect(runtimePrompt).toContain('shared append');
    expect(readFileSync(join(runtime, 'AGENTS.md'), 'utf-8')).toContain('# Datadog');
    expect(runtimeSettings.defaultModel).toBe('gpt-5.4');
    expect(runtimeSettings.defaultProvider).toBe('openai-codex');
    expect(runtimeSettings.defaultThinkingLevel).toBe('high');
  });

  it('uses prompt-catalog/system.md as the system source when present', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'defaults/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(repo, 'prompt-catalog/system.md'), 'System source\n');
    writeFile(join(repo, 'prompt-catalog/system', '00-role.md'), 'legacy role\n');
    writeFile(join(profilesRoot, 'shared.json'), '{"title":"Shared"}\n');
    writeFile(join(syncRoot, 'nodes', 'checkpoint', 'INDEX.md'), `---
id: checkpoint
title: Checkpoint
summary: Commit and push
description: Commit and push
tags:
  - type:skill
---`);

    const resolved = resolveResourceProfile('shared', { repoRoot: repo, profilesRoot });
    const result = materializeProfileToAgentDir(resolved, runtime);
    const runtimePrompt = readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8');

    expect(result.writtenFiles.some((path) => path.endsWith('/APPEND_SYSTEM.md'))).toBe(true);
    expect(runtimePrompt).toContain('System source');
    expect(runtimePrompt).not.toContain('legacy role');
  });

  it('installs package sources into the selected durable settings file', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'assistant.json'), '{"title":"Assistant"}\n');
    writeFile(join(syncRoot, 'settings', 'assistant.json'), JSON.stringify({ packages: ['/existing-package'] }));

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
    expect(profileInstall.settingsPath).toBe(join(syncRoot, 'settings', 'assistant.json'));

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
  });

  it('builds pi args from resource directories', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'extensions/basic/index.ts'), 'export default {}\n');
    writeFile(join(syncRoot, 'nodes', 'test', 'INDEX.md'), '---\nid: test\ntitle: Test\nsummary: Skill\ndescription: Skill\ntags:\n  - type:skill\n---\n');
    writeFile(join(repo, 'prompt-catalog/system/00-role.md'), 'role\n');
    writeFile(join(repo, 'themes/theme.json'), '{}\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    const args = buildPiResourceArgs(resolved);

    expect(args).toContain('--no-extensions');
    expect(args).toContain('-e');
    expect(args).toContain(join(repo, 'extensions/basic/index.ts'));
    expect(args).toContain('--skill');
    expect(args).toContain(join(syncRoot, 'nodes', 'test'));
    expect(args).toContain('--theme');
    expect(args).toContain(join(repo, 'themes/theme.json'));
  });
});
