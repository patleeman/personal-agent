import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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

function memoryPath(profilesRoot: string, memoryName: string): string {
  return join(profilesRoot, '..', 'memory', memoryName, 'MEMORY.md');
}

function createMemoryRepo(): { repoRoot: string; profilesRoot: string; configPath: string; stateRoot: string } {
  const repoRoot = createTempDir('personal-agent-memory-repo-');
  const stateRoot = createTempDir('personal-agent-memory-state-');
  const profilesRoot = join(stateRoot, 'sync', 'profiles');
  const configDir = createTempDir('personal-agent-memory-config-');
  const configPath = join(configDir, 'config.json');

  writeFile(configPath, JSON.stringify({ defaultProfile: 'assistant' }));
  writeFile(join(repoRoot, 'defaults/agent/AGENTS.md'), '# Shared\n');
  writeFile(join(profilesRoot, 'assistant.json'), '{"title":"Assistant"}\n');

  return {
    repoRoot,
    profilesRoot,
    configPath,
    stateRoot,
  };
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

describe('memory command', () => {
  it('lists and shows global memory packages, migrating legacy profile files', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
type: project
status: active
tags: [gpu, infra]
updated: 2026-03-08
---
Runpod operational notes.
`,
    );

    writeFile(
      join(profilesRoot, 'assistant', 'agent', 'memory', 'desktop.md'),
      `---
id: desktop
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
type: reference
status: active
tags: [gpu, desktop]
updated: 2026-03-08
---
Desktop operational notes.
`,
    );

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const listExitCode = await runCli(['memory', 'list', '--json']);
    expect(listExitCode).toBe(0);

    const listPayload = JSON.parse(logs[0] as string) as {
      memoryDir: string;
      docs: Array<{ id: string; title: string }>;
      parseErrors: Array<unknown>;
    };

    expect(listPayload.memoryDir).toBe(join(profilesRoot, '..', 'memory'));
    expect(listPayload.docs.map((doc) => doc.id)).toEqual(['desktop', 'runpod']);
    expect(listPayload.parseErrors).toHaveLength(0);
    expect(readFileSync(memoryPath(profilesRoot, 'runpod'), 'utf-8')).toContain('name: runpod');

    logs.length = 0;

    const showExitCode = await runCli(['memory', 'show', 'runpod', '--json']);
    expect(showExitCode).toBe(0);

    const showPayload = JSON.parse(logs[0] as string) as {
      doc: {
        id: string;
        title: string;
        tags: string[];
      };
    };

    expect(showPayload.doc.id).toBe('runpod');
    expect(showPayload.doc.title).toBe('Runpod Notes');
    expect(showPayload.doc.tags).toContain('gpu');

    logSpy.mockRestore();
  });

  it('filters memory packages by tag/type/status/text', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      memoryPath(profilesRoot, 'runpod'),
      `---
name: runpod
description: Provisioning notes for short-lived GPU pods.
metadata:
  title: Runpod Notes
  type: project
  status: active
  area: compute
  role: hub
  tags:
    - gpu
    - infra
  updated: 2026-03-08
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(
      memoryPath(profilesRoot, 'desktop'),
      `---
name: desktop
description: Local Ubuntu GPU workstation details.
metadata:
  title: Desktop Machine Notes
  type: reference
  status: archived
  area: compute
  role: hub
  tags:
    - gpu
    - desktop
  updated: 2026-03-08
---
# Desktop

Desktop Ubuntu operational notes.
`,
    );

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli([
      'memory',
      'find',
      '--tag',
      'gpu',
      '--type',
      'reference',
      '--status',
      'archived',
      '--area',
      'compute',
      '--text',
      'ubuntu',
      '--json',
    ]);

    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs[0] as string) as {
      docs: Array<{ id: string }>;
    };

    expect(payload.docs).toHaveLength(1);
    expect(payload.docs[0]).toMatchObject({ id: 'desktop' });

    logSpy.mockRestore();
  });

  it('fails lint when docs have parse errors or duplicate ids', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      memoryPath(profilesRoot, 'runpod'),
      `---
name: runpod
description: Provisioning notes for short-lived GPU pods.
metadata:
  title: Runpod Notes
  type: project
  status: active
  tags:
    - gpu
    - infra
  updated: 2026-03-08
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(
      memoryPath(profilesRoot, 'invalid'),
      '# Missing frontmatter\n',
    );

    writeFile(
      memoryPath(profilesRoot, 'orphan'),
      `---
name: orphan
description: Broken parent reference.
metadata:
  title: Orphan
  type: note
  status: active
  parent: missing-parent
  tags:
    - test
  updated: 2026-03-08
---
# Orphan

Broken parent reference.
`,
    );

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['memory', 'lint', '--json']);
    expect(exitCode).toBe(1);

    const payload = JSON.parse(logs[0] as string) as {
      parseErrors: Array<unknown>;
      duplicateIds: Array<{ id: string }>;
      referenceErrors: Array<{ id: string; field: string; targetId: string }>;
    };

    expect(payload.parseErrors.length).toBe(2);
    expect(payload.duplicateIds).toHaveLength(0);
    expect(payload.referenceErrors).toEqual([]);

    logSpy.mockRestore();
  });

  it('creates a memory package template with memory new', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli([
      'memory',
      'new',
      'quick-note',
      '--title',
      'Quick Note',
      '--summary',
      'Tracks one-off details.',
      '--tags',
      'notes,personal',
      '--type',
      'note',
      '--status',
      'active',
      '--area',
      'memory',
      '--role',
      'hub',
      '--related',
      'personal-agent',
      '--json',
    ]);

    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs[0] as string) as {
      id: string;
      filePath: string;
      tags: string[];
      type: string;
      status: string;
      area?: string;
      role?: string;
      related: string[];
      overwritten: boolean;
      updated: string;
    };

    expect(payload.id).toBe('quick-note');
    expect(payload.filePath).toBe(memoryPath(profilesRoot, 'quick-note'));
    expect(payload.tags).toEqual(['notes', 'personal']);
    expect(payload.type).toBe('note');
    expect(payload.status).toBe('active');
    expect(payload.area).toBe('memory');
    expect(payload.role).toBe('hub');
    expect(payload.related).toEqual(['personal-agent']);
    expect(payload.overwritten).toBe(false);
    expect(payload.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fileContent = readFileSync(payload.filePath, 'utf-8');
    expect(fileContent).toContain('name: quick-note');
    expect(fileContent).toContain('description: Tracks one-off details.');
    expect(fileContent).toContain('metadata:');
    expect(fileContent).toContain('title: Quick Note');
    expect(fileContent).toContain('area: memory');
    expect(fileContent).toContain('role: hub');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('- personal-agent');
    expect(fileContent).toContain('tags:');
    expect(fileContent).toContain('- notes');
    expect(fileContent).toContain('- personal');

    logSpy.mockRestore();
  });

  it('requires --force to overwrite an existing memory package', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const initialLogs: string[] = [];
    const initialLogSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      initialLogs.push(String(message ?? ''));
    });

    expect(await runCli([
      'memory',
      'new',
      'quick-note',
      '--title',
      'Initial Note',
      '--summary',
      'Initial summary.',
      '--tags',
      'notes',
      '--json',
    ])).toBe(0);

    expect(initialLogs).toHaveLength(1);
    initialLogSpy.mockRestore();

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const withoutForceExitCode = await runCli([
      'memory',
      'new',
      'quick-note',
      '--title',
      'Updated Note',
      '--summary',
      'Updated summary.',
      '--tags',
      'notes',
      '--json',
    ]);

    expect(withoutForceExitCode).toBe(1);
    expect(errors.some((line) => line.includes('Memory package already exists'))).toBe(true);

    errorSpy.mockRestore();

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const withForceExitCode = await runCli([
      'memory',
      'new',
      'quick-note',
      '--title',
      'Updated Note',
      '--summary',
      'Updated summary.',
      '--tags',
      'notes',
      '--force',
      '--json',
    ]);

    expect(withForceExitCode).toBe(0);

    const payload = JSON.parse(logs[0] as string) as { overwritten: boolean; filePath: string };
    expect(payload.overwritten).toBe(true);

    const fileContent = readFileSync(payload.filePath, 'utf-8');
    expect(fileContent).toContain('title: Updated Note');

    logSpy.mockRestore();
  });
});
