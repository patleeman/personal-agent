import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPiResourceArgs,
  installPackageSource,
  listRuntimeScopes,
  materializeRuntimeResourcesToAgentDir,
  mergeJsonFiles,
  readPackageSourceTargetState,
  resolveLocalProfileSettingsFilePath,
  resolveRuntimeResources,
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

function createTempRuntimeConfigRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-config-'));
  const runtimeConfigRoot = join(root, 'sync', '_profiles');
  mkdirSync(runtimeConfigRoot, { recursive: true });
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(root, 'sync');
  tempDirs.push(root);
  return runtimeConfigRoot;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('runtime resource loader', () => {
  it('exposes a single shared runtime scope', () => {
    const repo = createTempRepo();
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(runtimeConfigRoot, 'datadog', 'settings.json'), JSON.stringify({}));

    const profiles = listRuntimeScopes({ repoRoot: repo, runtimeConfigRoot });
    expect(profiles).toEqual(['shared']);
  });

  it('resolves durable resources plus local overlays', () => {
    const repo = createTempRepo();
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(syncRoot, 'AGENTS.md'), '# Durable shared\n');
    writeFile(join(runtimeConfigRoot, 'shared', 'settings.json'), JSON.stringify({ nested: { two: true } }));
    writeFile(join(runtimeConfigRoot, 'datadog', 'settings.json'), JSON.stringify({ datadog: true }));
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

    const resolved = resolveRuntimeResources('datadog', {
      repoRoot: repo,
      runtimeConfigRoot,
      localProfileDir: local,
    });

    expect(resolved.layers.map((layer) => layer.name)).toEqual(['defaults', 'durable', 'local']);
    expect(resolved.agentsFiles).toEqual([
      join(repo, 'defaults/agent/AGENTS.md'),
      join(syncRoot, 'AGENTS.md'),
      join(local, 'agent', 'AGENTS.md'),
    ]);
    expect(resolved.settingsFiles).toEqual([join(runtimeConfigRoot, 'shared', 'settings.json'), join(local, 'agent', 'settings.json')]);
    expect(resolved.skillDirs).toEqual([join(syncRoot, 'skills', 'datadog-skill'), join(syncRoot, 'skills', 'shared-skill')]);
    expect(resolved.extensionEntries).toEqual([]);
  });

  it('includes configured machine instruction files in the materialized AGENTS stack', () => {
    const repo = createTempRepo();
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');
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

    const resolved = resolveRuntimeResources('shared', {
      repoRoot: repo,
      runtimeConfigRoot,
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
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');
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

    const resolved = resolveRuntimeResources('shared', {
      repoRoot: repo,
      runtimeConfigRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.skillDirs).toEqual([join(syncRoot, 'skills', 'vault-skill'), join(externalSkillsDir, 'machine-skill')]);
  });

  it('includes skill dirs regardless of profile metadata', () => {
    const repo = createTempRepo();
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(syncRoot, 'skills', 'datadog-helper', 'SKILL.md'),
      `---
name: datadog-helper
description: Use for Datadog helper workflows.
metadata:
  profile: datadog
---
# Datadog Helper
`,
    );

    const resolved = resolveRuntimeResources('shared', {
      repoRoot: repo,
      runtimeConfigRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.skillDirs).toEqual([join(syncRoot, 'skills', 'datadog-helper')]);
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
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');
    const runtime = mkdtempSync(join(tmpdir(), 'personal-agent-runtime-'));
    tempDirs.push(runtime);
    process.env.PERSONAL_AGENT_VAULT_ROOT = syncRoot;

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(repo, 'defaults/agent/APPEND_SYSTEM.md'), 'shared append\n');
    writeFile(join(repo, 'defaults/agent/models.json'), JSON.stringify({ providers: { a: {} } }));
    writeFile(join(syncRoot, 'AGENTS.md'), '# Durable shared\n');
    writeFile(
      join(runtimeConfigRoot, 'shared', 'settings.json'),
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

    const resolved = resolveRuntimeResources('datadog', { repoRoot: repo, runtimeConfigRoot });
    const result = materializeRuntimeResourcesToAgentDir(resolved, runtime);
    const runtimeSettings = JSON.parse(readFileSync(join(runtime, 'settings.json'), 'utf-8')) as Record<string, unknown>;
    const runtimePrompt = readFileSync(join(runtime, 'APPEND_SYSTEM.md'), 'utf-8');

    expect(result.writtenFiles.some((path) => path.endsWith('/AGENTS.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/APPEND_SYSTEM.md'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/settings.json'))).toBe(true);
    expect(result.writtenFiles.some((path) => path.endsWith('/models.json'))).toBe(true);
    expect(runtimePrompt).toContain('# Personal agent defaults');
    expect(runtimePrompt).toContain(`Docs index: ${join(repo, 'docs', 'index.md')}`);
    expect(runtimePrompt).toContain(`Extension authoring docs: ${join(repo, 'docs', 'extensions.md')}`);
    expect(runtimePrompt).toContain('shared append');
    expect(runtimePrompt).not.toContain('<available_skills>');
    expect(runtimePrompt).not.toContain(join(syncRoot, 'skills', 'checkpoint', 'SKILL.md'));
    expect(runtimePrompt).not.toContain("Commit and push the agent's current work.");
    expect(runtimePrompt).toContain(`Vault root: ${syncRoot}`);
    expect(readFileSync(join(runtime, 'AGENTS.md'), 'utf-8')).toContain('# Durable shared');
    expect(runtimeSettings.defaultModel).toBe('gpt-5.4');
    expect(runtimeSettings.defaultProvider).toBe('openai-codex');
    expect(runtimeSettings.defaultThinkingLevel).toBe('high');
  });

  it('installs package sources into local settings', () => {
    const repo = createTempRepo();
    const local = mkdtempSync(join(tmpdir(), 'personal-agent-local-'));
    tempDirs.push(local);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(local, 'settings.json'), JSON.stringify({ packages: ['/existing-package'] }));

    const localInstall = installPackageSource({
      repoRoot: repo,
      localProfileDir: local,
      source: './local-package',
      target: 'local',
      sourceBaseDir: repo,
    });

    expect(localInstall.installed).toBe(true);
    expect(localInstall.settingsPath).toBe(resolveLocalProfileSettingsFilePath({ localProfileDir: local }));
    expect(readPackageSourceTargetState('local', { repoRoot: repo, localProfileDir: local }).packages).toEqual([
      { source: '/existing-package', filtered: false },
      { source: join(repo, 'local-package'), filtered: false },
    ]);
  });

  it('builds pi args from resource directories', () => {
    const repo = createTempRepo();
    const runtimeConfigRoot = createTempRuntimeConfigRoot();
    const syncRoot = join(runtimeConfigRoot, '..');
    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(syncRoot, 'skills', 'test', 'SKILL.md'), '---\nname: test\ndescription: Skill\n---\n# Test\n');

    const resolved = resolveRuntimeResources('shared', {
      repoRoot: repo,
      runtimeConfigRoot,
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
    const runtimeConfigRoot = join(syncRoot, '_profiles');
    tempDirs.push(root);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(join(runtimeConfigRoot, 'shared', 'settings.json'), JSON.stringify({ defaultModel: 'gpt-5.4' }));
    writeFile(
      join(syncRoot, '_skills', 'checkpoint', 'SKILL.md'),
      `---
name: checkpoint
description: Commit your work.
---
# Checkpoint
`,
    );

    const profiles = listRuntimeScopes({ repoRoot: repo, runtimeConfigRoot });
    expect(profiles).toEqual(['shared']);

    const resolved = resolveRuntimeResources('default', {
      repoRoot: repo,
      vaultRoot: syncRoot,
      runtimeConfigRoot,
      localProfileDir: join(repo, '.local-profile'),
    });

    expect(resolved.agentsFiles).toEqual([join(repo, 'defaults/agent/AGENTS.md')]);
    expect(resolved.settingsFiles).toContain(join(runtimeConfigRoot, 'shared', 'settings.json'));
    expect(resolved.skillDirs).toEqual([join(syncRoot, '_skills', 'checkpoint')]);
  });
});
