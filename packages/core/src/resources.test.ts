import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPiResourceArgs,
  installPackageSource,
  listProfiles,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  readPackageSourceTargetState,
  resolveLocalProfileSettingsFilePath,
  resolveResourceProfile,
} from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-resources-'));
  tempDirs.push(dir);
  return dir;
}

function createTempProfilesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-profiles-'));
  const profilesRoot = join(root, 'sync', '_profiles');
  mkdirSync(profilesRoot, { recursive: true });
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(root, 'sync');
  tempDirs.push(root);
  return profilesRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('resources profile loader', () => {
  it('exposes a single shared profile', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'datadog', 'settings.json'), JSON.stringify({}));

    const profiles = listProfiles({ repoRoot: repo, profilesRoot });
    expect(profiles).toEqual(['shared']);
  });

  it('resolves durable resources plus local overlays', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(syncRoot, 'AGENTS.md'), '# Durable shared\n');
    writeFile(join(profilesRoot, 'shared', 'settings.json'), JSON.stringify({ nested: { two: true } }));
    writeFile(join(profilesRoot, 'datadog', 'settings.json'), JSON.stringify({ datadog: true }));
    writeFile(
      join(syncRoot, 'skills', 'shared-skill', 'SKILL.md'),
      '---\nname: shared-skill\ndescription: Shared\nprofiles:\n  - shared\n---\n',
    );
    writeFile(
      join(syncRoot, 'skills', 'datadog-skill', 'SKILL.md'),
      '---\nname: datadog-skill\ndescription: Datadog\nprofiles:\n  - datadog\n---\n',
    );
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
      join(syncRoot, 'AGENTS.md'),
      join(local, 'agent', 'AGENTS.md'),
    ]);
    expect(resolved.settingsFiles).toEqual([join(profilesRoot, 'shared', 'settings.json'), join(local, 'agent', 'settings.json')]);
    expect(resolved.skillDirs).toEqual([join(syncRoot, 'skills', 'shared-skill')]);
    expect(resolved.extensionEntries).toEqual([]);
  });

  it('includes configured machine instruction files in the materialized AGENTS stack', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const configRoot = mkdtempSync(join(tmpdir(), 'personal-agent-config-'));
    tempDirs.push(configRoot);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(syncRoot, 'AGENTS.md'), '# Vault Root\n');
    writeFile(join(repo, 'custom-instructions.md'), '# Custom Instructions\n');
    writeFile(
      join(configRoot, 'config.json'),
      JSON.stringify({
        instructionFiles: [join(repo, 'custom-instructions.md')],
      }),
    );
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configRoot, 'config.json');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.agentsFiles).toEqual([
      join(repo, 'defaults/agent/AGENTS.md'),
      join(syncRoot, 'AGENTS.md'),
      join(repo, 'custom-instructions.md'),
    ]);
  });

  it('includes configured machine skill directories alongside durable skills', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const syncRoot = join(profilesRoot, '..');
    const configRoot = mkdtempSync(join(tmpdir(), 'personal-agent-config-'));
    const externalSkillsDir = mkdtempSync(join(tmpdir(), 'personal-agent-extra-skills-'));
    tempDirs.push(configRoot, externalSkillsDir);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(syncRoot, 'skills', 'vault-skill', 'SKILL.md'),
      '---\nname: vault-skill\ndescription: Vault skill\n---\n# Vault Skill\n',
    );
    writeFile(
      join(externalSkillsDir, 'machine-skill', 'SKILL.md'),
      '---\nname: machine-skill\ndescription: Machine skill\n---\n# Machine Skill\n',
    );
    writeFile(
      join(configRoot, 'config.json'),
      JSON.stringify({
        skillDirs: [externalSkillsDir],
      }),
    );
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configRoot, 'config.json');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.skillDirs).toEqual([join(syncRoot, 'skills', 'vault-skill'), join(externalSkillsDir, 'machine-skill')]);
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
    process.env.PERSONAL_AGENT_VAULT_ROOT = syncRoot;

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'defaults/agent/APPEND_SYSTEM.md'), 'shared append\n');
    writeFile(join(repo, 'defaults/agent/models.json'), JSON.stringify({ providers: { a: {} } }));
    writeFile(join(syncRoot, 'AGENTS.md'), '# Durable shared\n');
    writeFile(
      join(profilesRoot, 'shared', 'settings.json'),
      JSON.stringify({
        datadog: true,
        defaultProvider: 'openai-codex',
        defaultModel: 'gpt-5.4',
        defaultThinkingLevel: 'high',
      }),
    );
    writeFile(
      join(syncRoot, 'skills', 'checkpoint', 'SKILL.md'),
      `---
name: checkpoint
description: Commit and push the agent's current work.
---
# Checkpoint
`,
    );

    const resolved = resolveResourceProfile('datadog', { repoRoot: repo, profilesRoot });
    const result = materializeProfileToAgentDir(resolved, runtime);
    const runtimeSettings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const runtimePrompt = readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8');

    expect(result.writtenFiles.some((path) => path.endsWith('/AGENTS.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/APPEND_SYSTEM.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/settings.json'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/models.json'))).toBe(true);
    expect(runtimePrompt).toContain('# Identity & Goal');
    expect(runtimePrompt).toContain('shared append');
    expect(runtimePrompt).toContain(`The canonical durable knowledge vault root is: ${syncRoot}`);
    expect(readFileSync(join(runtime, 'AGENTS.md'), 'utf-8')).toContain('# Durable shared');
    expect(runtimeSettings.defaultModel).toBe('gpt-5.4');
    expect(runtimeSettings.defaultProvider).toBe('openai-codex');
    expect(runtimeSettings.defaultThinkingLevel).toBe('high');
  });

  it('installs package sources into the selected durable settings file', () => {
    const repo = createTempRepo();
    const profilesRoot = createTempProfilesRoot();
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'assistant', 'settings.json'), JSON.stringify({ packages: ['/existing-package'] }));

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
    expect(profileInstall.settingsPath).toBe(join(profilesRoot, 'assistant', 'settings.json'));

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
    writeFile(join(syncRoot, 'skills', 'test', 'SKILL.md'), '---\nname: test\ndescription: Skill\n---\n# Test\n');

    const resolved = resolveResourceProfile('shared', {
      repoRoot: repo,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });
    const args = buildPiResourceArgs(resolved);

    expect(args).toContain('--no-extensions');
    expect(args).toContain('--skill');
    expect(args).toContain(join(syncRoot, 'skills', 'test'));
  });

  it('loads shared resources from canonical underscored durable directories', () => {
    const repo = createTempRepo();
    const root = mkdtempSync(join(tmpdir(), 'personal-agent-legacy-sync-'));
    const syncRoot = join(root, 'sync');
    const profilesRoot = join(syncRoot, '_profiles');
    tempDirs.push(root);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(profilesRoot, 'shared', 'settings.json'), JSON.stringify({ defaultModel: 'gpt-5.4' }));
    writeFile(
      join(syncRoot, '_skills', 'checkpoint', 'SKILL.md'),
      `---
name: checkpoint
description: Commit your work.
---
# Checkpoint
`,
    );

    const profiles = listProfiles({ repoRoot: repo, profilesRoot });
    expect(profiles).toEqual(['shared']);

    const resolved = resolveResourceProfile('default', {
      repoRoot: repo,
      vaultRoot: syncRoot,
      profilesRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.agentsFiles).toEqual([join(repo, 'defaults/agent/AGENTS.md')]);
    expect(resolved.settingsFiles).toContain(join(profilesRoot, 'shared', 'settings.json'));
    expect(resolved.skillDirs).toEqual([join(syncRoot, '_skills', 'checkpoint')]);
  });
});
