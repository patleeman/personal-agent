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

function notePath(profilesRoot: string, noteId: string): string {
  return join(profilesRoot, '..', 'nodes', noteId, 'INDEX.md');
}

function createNoteRepo(): { repoRoot: string; profilesRoot: string; configPath: string; stateRoot: string } {
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

describe('note command', () => {
  it('lists and shows shared note nodes', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNoteRepo();

    writeFile(
      notePath(profilesRoot, 'runpod'),
      `---
id: runpod
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:project
  - status:active
  - type:note
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(
      notePath(profilesRoot, 'desktop'),
      `---
id: desktop
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:reference
  - status:active
  - type:note
---
# Desktop

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

    const listExitCode = await runCli(['note', 'list', '--json']);
    expect(listExitCode).toBe(0);

    const listPayload = JSON.parse(logs[0] as string) as {
      noteDir: string;
      docs: Array<{ id: string; title: string }>;
      parseErrors: Array<unknown>;
    };

    expect(listPayload.noteDir).toBe(join(profilesRoot, '..', 'nodes'));
    expect(listPayload.docs.map((doc) => doc.id)).toEqual(['desktop', 'runpod']);
    expect(listPayload.parseErrors).toHaveLength(0);
    expect(readFileSync(notePath(profilesRoot, 'runpod'), 'utf-8')).toContain('id: runpod');

    logs.length = 0;

    const showExitCode = await runCli(['note', 'show', 'runpod', '--json']);
    expect(showExitCode).toBe(0);

    const showPayload = JSON.parse(logs[0] as string) as {
      doc: { id: string; title: string };
    };

    expect(showPayload.doc.id).toBe('runpod');
    expect(showPayload.doc.title).toBe('Runpod Notes');

    logSpy.mockRestore();
  });

  it('filters note nodes by type/status/text', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNoteRepo();

    writeFile(
      notePath(profilesRoot, 'runpod'),
      `---
id: runpod
kind: note
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
updatedAt: 2026-03-08
tags:
  - area:compute
  - noteType:project
  - status:active
  - type:note
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(
      notePath(profilesRoot, 'desktop'),
      `---
id: desktop
kind: note
title: Desktop Machine Notes
summary: Local Ubuntu GPU workstation details.
status: archived
updatedAt: 2026-03-08
tags:
  - area:compute
  - noteType:reference
  - status:archived
  - type:note
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
      'note',
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
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNoteRepo();

    writeFile(
      notePath(profilesRoot, 'runpod'),
      `---
id: runpod
kind: note
title: Runpod Notes
summary: Provisioning notes for short-lived GPU pods.
status: active
updatedAt: 2026-03-08
tags:
  - noteType:project
  - status:active
  - type:note
links:
  related:
    - missing-parent
    - runpod
---
# Runpod

Runpod operational notes.
`,
    );

    writeFile(notePath(profilesRoot, 'invalid'), '# Missing frontmatter\n');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['note', 'lint', '--json']);
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

  it('creates a note node template with note new', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNoteRepo();

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli([
      'note',
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
    expect(payload.filePath).toBe(notePath(profilesRoot, 'quick-note'));
    expect(payload.type).toBe('note');
    expect(payload.status).toBe('active');
    expect(payload.area).toBe('notes');
    expect(payload.role).toBe('structure');
    expect(payload.related).toEqual(['personal-agent']);
    expect(payload.overwritten).toBe(false);
    expect(payload.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const fileContent = readFileSync(payload.filePath, 'utf-8');
    expect(fileContent).toContain('id: quick-note');
    expect(fileContent).toContain('type:note');
    expect(fileContent).toContain('summary: Tracks one-off details.');
    expect(fileContent).toContain('title: Quick Note');
    expect(fileContent).toContain('area:notes');
    expect(fileContent).toContain('role:structure');
    expect(fileContent).toContain('tags:');
    expect(fileContent).toContain('related:');
    expect(fileContent).toContain('- personal-agent');

    logSpy.mockRestore();
  });

  it('requires --force to overwrite an existing note node', async () => {
    const { repoRoot, profilesRoot, configPath, stateRoot } = createNoteRepo();

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_PROFILES_ROOT = profilesRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const initialLogs: string[] = [];
    const initialLogSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      initialLogs.push(String(message ?? ''));
    });

    expect(await runCli([
      'note',
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
      'note',
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
      'note',
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
