import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMachineConfigFilePath,
  readMachineConfigSection,
  readMachineInstructionFiles,
  readMachineKnowledgeBase,
  readMachineSkillDirs,
  readMachineVaultRoot,
  updateMachineConfigSection,
  writeMachineDefaultProfile,
  writeMachineInstructionFiles,
  writeMachineKnowledgeBase,
  writeMachineSkillDirs,
  writeMachineVaultRoot,
} from './machine-config.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('machine config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses only PERSONAL_AGENT_CONFIG_FILE for the shared machine config path', () => {
    const configDir = createTempDir('pa-machine-config-');
    const daemonConfigPath = join(configDir, 'daemon.json');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const resolvedPath = getMachineConfigFilePath();
    expect(resolvedPath).not.toBe(daemonConfigPath);
    expect(resolvedPath.endsWith('/config.json')).toBe(true);

    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'custom-config.json');
    expect(getMachineConfigFilePath()).toBe(join(configDir, 'custom-config.json'));
  });

  it('still honors legacy section-specific env overrides', () => {
    const configDir = createTempDir('pa-machine-config-');
    const daemonConfigPath = join(configDir, 'daemon.json');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    updateMachineConfigSection('daemon', () => ({ modules: { tasks: { pollIntervalMs: 5000 } } }));

    expect(readMachineConfigSection('daemon')).toEqual({ modules: { tasks: { pollIntervalMs: 5000 } } });
    expect(JSON.parse(readFileSync(daemonConfigPath, 'utf-8'))).toEqual({ modules: { tasks: { pollIntervalMs: 5000 } } });
  });

  it('writes generic machine config to config.json even when daemon section env vars are set', () => {
    const configDir = createTempDir('pa-machine-config-');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = join(configDir, 'daemon.json');

    writeMachineDefaultProfile('assistant', { configRoot: configDir });

    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({ defaultProfile: 'assistant' });
  });

  it('reads and writes the machine vault root in config.json', () => {
    const configDir = createTempDir('pa-machine-config-');

    writeMachineVaultRoot('~/Documents/personal-agent', { configRoot: configDir });
    expect(readMachineVaultRoot({ configRoot: configDir })).toBe('~/Documents/personal-agent');
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({ vaultRoot: '~/Documents/personal-agent' });

    writeMachineVaultRoot('', { configRoot: configDir });
    expect(readMachineVaultRoot({ configRoot: configDir })).toBe('');
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({});
  });

  it('reads and writes the managed knowledge base repo in config.json', () => {
    const configDir = createTempDir('pa-machine-config-');

    writeMachineKnowledgeBase({ repoUrl: 'https://github.com/patleeman/kb.git', branch: 'trunk' }, { configRoot: configDir });
    expect(readMachineKnowledgeBase({ configRoot: configDir })).toEqual({
      repoUrl: 'https://github.com/patleeman/kb.git',
      branch: 'trunk',
    });
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({
      knowledgeBaseRepoUrl: 'https://github.com/patleeman/kb.git',
      knowledgeBaseBranch: 'trunk',
    });

    writeMachineKnowledgeBase({ repoUrl: '', branch: '' }, { configRoot: configDir });
    expect(readMachineKnowledgeBase({ configRoot: configDir })).toEqual({
      repoUrl: '',
      branch: 'main',
    });
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({});
  });

  it('reads and writes instruction files in config.json', () => {
    const configDir = createTempDir('pa-machine-config-');

    writeMachineInstructionFiles([
      '/Users/patrick/Documents/personal-agent/AGENTS.md',
      '  /Users/patrick/Documents/personal-agent/skills/checkpoint/SKILL.md  ',
      '/Users/patrick/Documents/personal-agent/AGENTS.md',
      '',
    ], { configRoot: configDir });

    expect(readMachineInstructionFiles({ configRoot: configDir })).toEqual([
      '/Users/patrick/Documents/personal-agent/AGENTS.md',
      '/Users/patrick/Documents/personal-agent/skills/checkpoint/SKILL.md',
    ]);
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({
      instructionFiles: [
        '/Users/patrick/Documents/personal-agent/AGENTS.md',
        '/Users/patrick/Documents/personal-agent/skills/checkpoint/SKILL.md',
      ],
    });

    writeMachineInstructionFiles([], { configRoot: configDir });
    expect(readMachineInstructionFiles({ configRoot: configDir })).toEqual([]);
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({});
  });

  it('reads and writes skill directories in config.json', () => {
    const configDir = createTempDir('pa-machine-config-');

    writeMachineSkillDirs([
      '/Users/patrick/Documents/personal-agent/skills',
      '  /Users/patrick/Documents/shared-skills  ',
      '/Users/patrick/Documents/personal-agent/skills',
      '',
    ], { configRoot: configDir });

    expect(readMachineSkillDirs({ configRoot: configDir })).toEqual([
      '/Users/patrick/Documents/personal-agent/skills',
      '/Users/patrick/Documents/shared-skills',
    ]);
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({
      skillDirs: [
        '/Users/patrick/Documents/personal-agent/skills',
        '/Users/patrick/Documents/shared-skills',
      ],
    });

    writeMachineSkillDirs([], { configRoot: configDir });
    expect(readMachineSkillDirs({ configRoot: configDir })).toEqual([]);
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({});
  });
});
