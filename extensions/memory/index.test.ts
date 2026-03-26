import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import memoryExtension, { resolveMemoryProfileContext } from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeNoteNode(stateRoot: string, noteId: string, summary: string): void {
  mkdirSync(join(stateRoot, 'notes', noteId), { recursive: true });
  writeFileSync(join(stateRoot, 'notes', noteId, 'INDEX.md'), `---
id: ${noteId}
kind: note
title: ${noteId}
summary: ${summary}
status: active
---

# ${noteId}
`);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  delete process.env.PERSONAL_AGENT_PROFILE;
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
  delete process.env.PERSONAL_AGENT_PROFILES_ROOT;
});

describe('memory extension', () => {
  it('injects active profile path targets, node policy instructions, and available notes', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(stateRoot, 'profiles', 'datadog', 'agent'), { recursive: true });
    writeNoteNode(stateRoot, 'runpod', 'Provisioning notes for short-lived GPU pods.');

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    memoryExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      { prompt: 'please remember this setup', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: { customType?: string; content?: string; display?: boolean } } | undefined;

    expect(result?.systemPrompt).toContain('NODE_POLICY');
    expect(result?.systemPrompt).toContain('- active_profile: datadog');
    expect(result?.systemPrompt).toContain(`- Shared notes dir: ${join(stateRoot, 'notes')}`);
    expect(result?.systemPrompt).toContain(`- Note node template: ${join(stateRoot, 'notes', '<note-id>', 'INDEX.md')}`);
    expect(result?.systemPrompt).toContain('Use active-profile AGENTS.md + skills + shared note nodes as the durable node system.');
    expect(result?.systemPrompt).toContain('<available_notes>');
    expect(result?.systemPrompt).toContain('<note id="runpod"');
    expect(result?.systemPrompt).toContain(join(stateRoot, 'notes', 'runpod', 'INDEX.md'));
    expect(result?.message).toBeUndefined();
  });

  it('falls back to shared when requested profile directory is missing', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'missing-profile';

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    memoryExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'what should we retain?', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: { content?: string } } | undefined;

    expect(result?.systemPrompt).toContain('- active_profile: shared');
    expect(result?.systemPrompt).toContain('- requested_profile: missing-profile');
    expect(result?.systemPrompt).toContain('requested profile was missing');
    expect(result?.systemPrompt).toContain('- AGENTS.md edit target: none (shared profile does not use AGENTS.md)');
    expect(result?.systemPrompt).toContain('- Scheduled tasks dir: none (shared profile does not use profile task dir)');
    expect(result?.systemPrompt).toContain(`- Shared notes dir: ${join(stateRoot, 'notes')}`);
    expect(result?.message).toBeUndefined();
  });

  it('does not inject node policy for slash commands or empty prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    memoryExtension(pi as never);

    const slashResult = await beforeAgentStartHandler!(
      { prompt: '/model', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    );

    const emptyResult = await beforeAgentStartHandler!(
      { prompt: '   ', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    );

    expect(slashResult).toBeUndefined();
    expect(emptyResult).toBeUndefined();
  });

  it('injects only the lean node policy for generic prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(stateRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    memoryExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'inspect the sync prompt behavior', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: unknown } | undefined;

    expect(result?.systemPrompt).toContain('NODE_POLICY');
    expect(result?.message).toBeUndefined();
  });

  it('resolves the active memory profile context', () => {
    const repoRoot = createTempDir('memory-context-repo-');
    const stateRoot = createTempDir('memory-context-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(stateRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

    const context = resolveMemoryProfileContext(repoRoot);
    expect(context.activeProfile).toBe('datadog');
    expect(context.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(context.activeAgentsFile).toBe(join(stateRoot, 'profiles', 'datadog', 'agent', 'AGENTS.md'));
    expect(context.activeMemoryDir).toBe(join(stateRoot, 'notes'));
  });
});
