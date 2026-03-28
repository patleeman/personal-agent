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

function memoryPath(profilesRoot: string, noteId: string): string {
  return join(profilesRoot, '..', 'notes', noteId, 'INDEX.md');
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

describe('memory command', () => {
  it('lists and shows shared note nodes, migrating legacy profile files', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
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

    expect(listPayload.memoryDir).toBe(join(profilesRoot, '..', 'notes'));
    expect(listPayload.docs.map((doc) => doc.id)).toEqual(['desktop', 'runpod']);
    expect(listPayload.parseErrors).toHaveLength(0);
    expect(readFileSync(memoryPath(profilesRoot, 'runpod'), 'utf-8')).toContain('id: runpod');

    logs.length = 0;

    const showExitCode = await runCli(['memory', 'show', 'runpod', '--json']);
    expect(showExitCode).toBe(0);

    const showPayload = JSON.parse(logs[0] as string) as {
      doc: { id: string; title: string };
    };

    expect(showPayload.doc.id).toBe('runpod');
    expect(showPayload.doc.title).toBe('Runpod Notes');

    logSpy.mockRestore();
  });

  it('filters note nodes by type/status/text', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      memoryPath(profilesRoot, 'runpod'),
      `---
id: runpod
kind: note
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
tags:
  - gpu
  - infra
updatedAt: 2026-03-08
metadata:
  type: project
  area: compute
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(
      memoryPath(profilesRoot, 'desktop'),
      `---
id: desktop
kind: note
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
status: archived
tags:
  - gpu
  - desktop
updatedAt: 2026-03-08
metadata:
  type: reference
  area: compute
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

  it('fails lint when docs have parse errors or broken links', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createMemoryRepo();

    writeFile(
      memoryPath(profilesRoot, 'runpod'),
      `---
id: runpod
kind: note
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
tags:
  - gpu
updatedAt: 2026-03-08
links:
  related:
    - missing-parent
    - runpod
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(memoryPath(profilesRoot, 'invalid'), '# Missing frontmatter\n');

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

    expect(payload.parseErrors).toHaveLength(1);
    expect(payload.duplicateIds).toHaveLength(0);
    expect(payload.referenceErrors).toEqual([
      expect.objectContaining({ id: 'runpod', field: 'related', targetId: 'missing-parent' }),
      expect.objectContaining({ id: 'runpod', field: 'related', targetId: 'runpod' }),
    ]);

    logSpy.mockRestore();
  });

  it('creates a note node template with memory new', async () => {
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
      '--type',
      'note',
      '--status',
      'active',
      '--area',
      'notes',
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
    expect(payload.type).toBe('note');
    expect(payload.status).toBe('active');
    expect(payload.area).toBe('notes');
    expect(payload.role).toBe('structure');
    expect(payload.related).toEqual(['personal-agent']);
    expect(payload.overwritten).toBe(false);
    expect(payload.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fileContent = readFileSync(payload.filePath, 'utf-8');
    expect(fileContent).toContain('id: quick-note');
    expect(fileContent).toContain('kind: note');
    expect(fileContent).toContain('summary: Tracks one-off details.');
    expect(fileContent).toContain('title: Quick Note');
    expect(fileContent).toContain('area: notes');
    expect(fileContent).toContain('role: structure');
    expect(fileContent).not.toContain('tags:');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('- personal-agent');

    logSpy.mockRestore();
  });

  it('requires --force to overwrite an existing note node', async () => {
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
      '--json',
    ]);

    expect(withoutForceExitCode).toBe(1);
    expect(errors.join('\n')).toContain('already exists');
    errorSpy.mockRestore();

    const overwriteLogs: string[] = [];
    const overwriteLogSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      overwriteLogs.push(String(message ?? ''));
    });

    const withForceExitCode = await runCli([
      'memory',
      'new',
      'quick-note',
      '--title',
      'Updated Note',
      '--summary',
      'Updated summary.',
      '--force',
      '--json',
    ]);

    expect(withForceExitCode).toBe(0);
    const overwritePayload = JSON.parse(overwriteLogs[0] as string) as { overwritten: boolean; filePath: string };
    expect(overwritePayload.overwritten).toBe(true);
    expect(readFileSync(overwritePayload.filePath, 'utf-8')).toContain('title: Updated Note');

    overwriteLogSpy.mockRestore();
  });
});
