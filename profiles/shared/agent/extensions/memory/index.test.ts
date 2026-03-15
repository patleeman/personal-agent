import { mkdtempSync, mkdirSync } from 'node:fs';
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  delete process.env.PERSONAL_AGENT_PROFILE;
});

describe('memory extension', () => {
  it('injects active profile path targets and memory policy instructions', async () => {
    const repoRoot = createTempDir('memory-repo-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

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
      {
        prompt: 'please remember this setup',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: { customType?: string; content?: string; display?: boolean } } | undefined;

    expect(result?.systemPrompt).toContain('MEMORY_POLICY');
    expect(result?.systemPrompt).toContain('- active_profile: datadog');
    expect(result?.systemPrompt).toContain('Profile memory write targets (edit these locations directly):');
    expect(result?.systemPrompt).toContain('- AGENTS.md edit target: profiles/datadog/agent/AGENTS.md');
    expect(result?.systemPrompt).toContain('- Skills dir: profiles/datadog/agent/skills');
    expect(result?.systemPrompt).toContain('- Scheduled tasks dir: profiles/datadog/agent/tasks');
    expect(result?.systemPrompt).toContain('- Memory dir: profiles/datadog/agent/memory');
    expect(result?.systemPrompt).toContain('Use profile-local AGENTS.md, skills, and memory docs as the durable memory system.');
    expect(result?.systemPrompt).not.toContain('pa memory list --profile datadog');
    expect(result?.message?.customType).toBe('memory-operations-reminder');
    expect(result?.message?.display).toBe(false);
    expect(result?.message?.content).toContain('SYSTEM_REMINDER: This request touches durable memory or profile behavior.');
    expect(result?.message?.content).toContain('pa memory list --profile datadog');
    expect(result?.message?.content).toContain('pa memory find --profile datadog --text <query>');
    expect(result?.message?.content).toContain('pa memory show <id> --profile datadog');
    expect(result?.message?.content).toContain('Use the active profile targets already present in system context.');
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
    };

    memoryExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      {
        prompt: 'what should we retain?',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: { content?: string } } | undefined;

    expect(result?.systemPrompt).toContain('- active_profile: shared');
    expect(result?.systemPrompt).toContain('- requested_profile: missing-profile');
    expect(result?.systemPrompt).toContain('requested profile was missing');
    expect(result?.systemPrompt).toContain('- AGENTS.md edit target: none (shared profile does not use AGENTS.md)');
    expect(result?.systemPrompt).toContain('- Scheduled tasks dir: none (shared profile does not use profile task dir)');
    expect(result?.systemPrompt).toContain('- Memory dir: none (shared profile has no memory dir)');
    expect(result?.systemPrompt).not.toContain('pa memory list --profile shared');
    expect(result?.message?.content).toContain('Shared profile has no profile-local memory docs');
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

  it('injects only the lean memory policy for generic prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

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
      {
        prompt: 'inspect the gateway prompt behavior',
        systemPrompt: 'BASE_SYSTEM_PROMPT',
      },
      { cwd: repoRoot },
    ) as { systemPrompt?: string; message?: unknown } | undefined;

    expect(result?.systemPrompt).toContain('MEMORY_POLICY');
    expect(result?.systemPrompt).not.toContain('pa memory list --profile datadog');
    expect(result?.message).toBeUndefined();
  });

  it('resolves the active memory profile context', () => {
    const repoRoot = createTempDir('memory-context-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent'), { recursive: true });

    const context = resolveMemoryProfileContext(repoRoot);
    expect(context.activeProfile).toBe('datadog');
    expect(context.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(context.activeAgentsFile).toBe(join(repoRoot, 'profiles', 'datadog', 'agent', 'AGENTS.md'));
    expect(context.activeMemoryDir).toBe(join(repoRoot, 'profiles', 'datadog', 'agent', 'memory'));
  });
});
