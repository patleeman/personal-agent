import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import notePolicyExtension, { resolveNoteProfileContext } from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeNoteNode(notesDir: string, noteId: string, summary: string): void {
  mkdirSync(join(notesDir, noteId), { recursive: true });
  writeFileSync(join(notesDir, noteId, 'INDEX.md'), `---
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
  delete process.env.PERSONAL_AGENT_VAULT_ROOT;
});

describe('note policy extension', () => {
  it('renders system.md with active profile and available notes', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(stateRoot, 'profiles', 'datadog', 'agent'), { recursive: true });
    writeNoteNode(join(stateRoot, 'notes'), 'runpod', 'Provisioning notes for short-lived GPU pods.');

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    notePolicyExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      { prompt: 'please remember this setup', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: stateRoot },
    ) as { systemPrompt?: string } | undefined;

    const prompt = result?.systemPrompt ?? '';
    expect(prompt).toContain('# Identity & Goal');
    expect(prompt).toContain('- active_profile: datadog');
    expect(prompt).toContain('- vault_root: vault');
    expect(prompt).toContain('- Shared notes dir: notes');
    expect(prompt).toContain('Use the active-profile `AGENTS.md`, skills, and shared note nodes');
    expect(prompt).toContain('<available_notes>');
    expect(prompt).toContain('<note id="runpod"');
    expect(prompt).toContain('notes/runpod/INDEX.md');
  });

  it('shows fallback note when requested profile is missing', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'missing-profile';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    notePolicyExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'what should we retain?', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    const prompt = result?.systemPrompt ?? '';
    expect(prompt).toContain('- active_profile: shared');
    expect(prompt).toContain(`- vault_root: ${join(stateRoot, 'vault')}`);
    expect(prompt).toContain('- requested_profile: missing-profile');
    expect(prompt).toContain('requested profile was missing');
    expect(prompt).toContain('- AGENTS.md: none (shared profile does not use AGENTS.md)');
    expect(prompt).toContain('- Scheduled tasks dir: none (shared profile does not use profile task dir) (Note: Scheduled tasks belong here, not in shared notes).');
    expect(prompt).not.toContain('## Shared Notes & Available Nodes');
  });

  it('does not inject for slash commands or empty prompts', async () => {
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

    notePolicyExtension(pi as never);

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

  it('renders NODE_POLICY for generic prompts', async () => {
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

    notePolicyExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'inspect the sync prompt behavior', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt ?? '').toContain('# Identity & Goal');
  });

  it('resolves the active note profile context', () => {
    const repoRoot = createTempDir('memory-context-repo-');
    const stateRoot = createTempDir('memory-context-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(stateRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(stateRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

    const context = resolveNoteProfileContext(repoRoot);
    expect(context.activeProfile).toBe('datadog');
    expect(context.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(context.activeAgentsFile).toBe(join(stateRoot, 'profiles', 'datadog', 'agent', 'AGENTS.md'));
    expect(context.activeNotesDir).toBe(join(stateRoot, 'notes'));
  });
});
