import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './index.js';

const originalEnv = process.env;
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

function createNodeRepo(): { repoRoot: string; profilesRoot: string; configPath: string; stateRoot: string } {
  const repoRoot = createTempDir('personal-agent-node-repo-');
  const stateRoot = createTempDir('personal-agent-node-state-');
  const profilesRoot = join(stateRoot, 'sync', 'profiles');
  const configDir = createTempDir('personal-agent-node-config-');
  const configPath = join(configDir, 'config.json');

  writeFile(configPath, JSON.stringify({ defaultProfile: 'assistant' }));
  writeFile(join(repoRoot, 'defaults/agent/AGENTS.md'), '# Shared\n');
  writeFile(join(profilesRoot, 'assistant.json'), '{"title":"Assistant"}\n');

  return { repoRoot, profilesRoot, configPath, stateRoot };
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_NO_DAEMON_PROMPT: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('node command', () => {
  it('creates, finds, tags, and lints unified nodes', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNodeRepo();

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const createExitCode = await runCli([
      'node',
      'new',
      'desktop',
      '--title',
      'Desktop',
      '--summary',
      'Ubuntu workstation details.',
      '--tag',
      'type:note',
      '--tag',
      'profile:assistant',
      '--tag',
      'area:compute',
      '--parent',
      'infrastructure',
      '--json',
    ]);
    expect(createExitCode).toBe(0);
    expect(JSON.parse(logs[0] as string)).toMatchObject({ node: { id: 'desktop' } });

    logs.length = 0;
    const findExitCode = await runCli(['node', 'find', 'type:note AND parent:infrastructure', '--json']);
    expect(findExitCode).toBe(0);
    expect(JSON.parse(logs[0] as string)).toMatchObject({ nodes: [expect.objectContaining({ id: 'desktop' })] });

    logs.length = 0;
    const tagExitCode = await runCli(['node', 'tag', 'desktop', '--add', 'lang:typescript', '--remove', 'area:compute', '--json']);
    expect(tagExitCode).toBe(0);
    expect(JSON.parse(logs[0] as string)).toMatchObject({ node: { id: 'desktop', tags: expect.arrayContaining(['lang:typescript']) } });

    logs.length = 0;
    const lintExitCode = await runCli(['node', 'lint', '--json']);
    expect(lintExitCode).toBe(1);
    expect(JSON.parse(logs[0] as string)).toMatchObject({
      referenceErrors: [expect.objectContaining({ id: 'desktop', field: 'parent', targetId: 'infrastructure' })],
    });

    logSpy.mockRestore();
  });

  it('migrates legacy note, skill, and project stores into unified nodes', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNodeRepo();

    writeFile(join(stateRoot, 'sync', 'notes', 'desktop', 'INDEX.md'), `---
id: desktop
kind: note
title: Desktop
summary: Ubuntu workstation details.
status: active
---

# Desktop

Ubuntu workstation details.
`);
    writeFile(join(stateRoot, 'sync', 'skills', 'agent-browser', 'INDEX.md'), `---
id: agent-browser
kind: skill
name: agent-browser
description: Browser automation.
title: agent-browser
summary: Browser automation.
profiles:
  - assistant
---

# agent-browser

Use the browser automation helper.
`);
    writeFile(join(stateRoot, 'sync', 'projects', 'ship-it', 'INDEX.md'), `---
id: ship-it
kind: project
title: Ship It
summary: Ship the feature.
status: active
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
---

# Ship It

Ship the feature.
`);
    writeFile(join(stateRoot, 'sync', 'projects', 'ship-it', 'state.yaml'), `id: ship-it
ownerProfile: assistant
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T01:00:00.000Z
title: Ship It
description: Ship the feature.
summary: Ship the feature.
requirements:
  goal: Launch the feature
  acceptanceCriteria: []
status: active
blockers: []
recentProgress: []
plan:
  milestones: []
  tasks: []
`);

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const migrateExitCode = await runCli(['node', 'migrate', '--json']);
    expect(migrateExitCode).toBe(0);
    expect(JSON.parse(logs[0] as string)).toMatchObject({ created: ['agent-browser', 'desktop', 'ship-it'] });

    logs.length = 0;
    const listExitCode = await runCli(['node', 'list', '--query', 'type:skill OR type:project', '--json']);
    expect(listExitCode).toBe(0);
    expect(JSON.parse(logs[0] as string)).toMatchObject({ nodes: expect.arrayContaining([expect.objectContaining({ id: 'agent-browser' }), expect.objectContaining({ id: 'ship-it' })]) });

    logSpy.mockRestore();
  });
});
