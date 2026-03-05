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
    expect(result?.systemPrompt).toContain('Profile memory write targets (edit these locations directly):');
    expect(result?.systemPrompt).toContain('- AGENTS.md edit target: profiles/datadog/agent/AGENTS.md');
    expect(result?.systemPrompt).toContain('- Skills dir: profiles/datadog/agent/skills');
    expect(result?.systemPrompt).toContain('- Workspace dir: profiles/datadog/agent/workspace');
    expect(result?.systemPrompt).toContain('workspace/projects/<project-slug>/PROJECT.md');
    expect(result?.systemPrompt).toContain('PA documentation (read when the user asks about pa/personal-agent');
    expect(result?.systemPrompt).toContain('- Docs folder: docs');
    expect(result?.systemPrompt).toContain('- Start with docs index: docs/README.md');
    expect(result?.systemPrompt).toContain('Use profile-local AGENTS.md, skills, and workspace docs as the durable memory system.');
    expect(result?.systemPrompt).toContain('Do not write durable memory into profiles/shared/agent/AGENTS.md.');
    expect(result?.systemPrompt).toContain('Do not use MEMORY.md files as durable memory.');
    expect(result?.systemPrompt).not.toContain('- Shared AGENTS.md:');
    expect(result?.systemPrompt).not.toContain('- Local AGENTS.md:');
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
    expect(result?.systemPrompt).toContain('- AGENTS.md edit target: none (shared profile does not use AGENTS.md)');
    expect(result?.systemPrompt).toContain('- Workspace dir: none (shared profile has no workspace)');
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
