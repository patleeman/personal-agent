import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import memoryExtension from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  delete process.env.PERSONAL_AGENT_PROFILE;
  delete process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;
});

describe('memory extension', () => {
  it('injects active profile context, layering, and memory policy instructions', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const localOverlayRoot = createTempDir('memory-local-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR = localOverlayRoot;

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent'), { recursive: true });
    mkdirSync(join(localOverlayRoot, 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
      registerTool: vi.fn(),
    };

    memoryExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      {
        prompt: 'please remember this setup',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain('MEMORY_POLICY');
    expect(result?.systemPrompt).toContain('- active_profile: datadog');
    expect(result?.systemPrompt).toContain('profiles/datadog/agent');
    expect(result?.systemPrompt).toContain('Resource layering (low -> high priority):');
    expect(result?.systemPrompt).toContain('Conflict rule: higher layer overrides lower layer (local > active profile > shared).');
    expect(result?.systemPrompt).toContain('3. Local overlay:');
    expect(result?.systemPrompt).toContain('- Local AGENTS.md:');
    expect(result?.systemPrompt).toContain('Use AGENTS.md and skills as the only durable memory system.');
    expect(result?.systemPrompt).toContain('carte blanche');
    expect(result?.systemPrompt).toContain('Do not use MEMORY.md files as durable memory.');
    expect(pi.registerTool).not.toHaveBeenCalled();
  });

  it('falls back to shared when requested profile directory is missing', async () => {
    const repoRoot = createTempDir('memory-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'missing-profile';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
      registerTool: vi.fn(),
    };

    memoryExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      {
        prompt: 'what should we retain?',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain('- active_profile: shared');
    expect(result?.systemPrompt).toContain('- requested_profile: missing-profile');
    expect(result?.systemPrompt).toContain('requested profile was missing');
    expect(result?.systemPrompt).toContain('3. Local overlay: not present');
  });

  it('does not inject memory policy for slash commands or empty prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
      registerTool: vi.fn(),
    };

    memoryExtension(pi as never);

    const slashResult = await beforeAgentStartHandler!(
      {
        prompt: '/model',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    );

    const emptyResult = await beforeAgentStartHandler!(
      {
        prompt: '   ',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    );

    expect(slashResult).toBeUndefined();
    expect(emptyResult).toBeUndefined();
  });
});
