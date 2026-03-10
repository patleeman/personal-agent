import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import memoryExtension, { buildMemoryBrowserRootMenu, resolveMemoryProfileContext } from './index';

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
      registerCommand: vi.fn(),
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
    expect(result?.systemPrompt).toContain('- Scheduled tasks dir: profiles/datadog/agent/tasks');
    expect(result?.systemPrompt).toContain('Scheduled tasks should live adjacent to memory (not inside memory).');
    expect(result?.systemPrompt).toContain('- Memory dir: profiles/datadog/agent/memory');
    expect(result?.systemPrompt).toContain('Memory doc template: profiles/datadog/agent/memory/<doc-id>.md');
    expect(result?.systemPrompt).toContain('PA documentation (read when the user asks about pa/personal-agent');
    expect(result?.systemPrompt).toContain('- Docs folder: docs');
    expect(result?.systemPrompt).toContain('- Start with docs index: docs/README.md');
    expect(result?.systemPrompt).toContain('Use profile-local AGENTS.md, skills, and memory docs as the durable memory system.');
    expect(result?.systemPrompt).toContain('AGENTS.md should stay high-level: user facts, durable role constraints, and broad operating policies.');
    expect(result?.systemPrompt).toContain('Skills are for workflows and tactics you expect to repeat.');
    expect(result?.systemPrompt).toContain('memory/*.md with YAML frontmatter');
    expect(result?.systemPrompt).toContain('Retrieval order: AGENTS.md for durable policy/facts, skills for reusable workflows/tactics, memory docs for profile/project context.');
    expect(result?.systemPrompt).toContain('pa memory list --profile datadog');
    expect(result?.systemPrompt).toContain('pa memory find --profile datadog --text <query>');
    expect(result?.systemPrompt).toContain('pa memory show <id> --profile datadog');
    expect(result?.systemPrompt).toContain('Use CLI discovery first, then use the read tool on the exact file before editing.');
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
      registerCommand: vi.fn(),
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
    expect(result?.systemPrompt).toContain('- Scheduled tasks dir: none (shared profile does not use profile task dir)');
    expect(result?.systemPrompt).toContain('- Memory dir: none (shared profile has no memory dir)');
    expect(result?.systemPrompt).toContain('Shared profile has no profile-local memory docs.');
    expect(result?.systemPrompt).not.toContain('pa memory list --profile shared');
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
      registerCommand: vi.fn(),
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

  it('builds a browser tree for skills, memories, and AGENTS files', () => {
    const repoRoot = createTempDir('memory-browser-repo-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    mkdirSync(join(repoRoot, 'profiles', 'shared', 'agent', 'skills', 'shared-skill', 'references'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent', 'skills', 'dd-skill', 'scripts'), { recursive: true });
    mkdirSync(join(repoRoot, 'profiles', 'datadog', 'agent', 'memory'), { recursive: true });

    writeFileSync(join(repoRoot, 'profiles', 'shared', 'agent', 'AGENTS.md'), '# Shared\n');
    writeFileSync(join(repoRoot, 'profiles', 'datadog', 'agent', 'AGENTS.md'), '# Datadog\n');
    writeFileSync(
      join(repoRoot, 'profiles', 'shared', 'agent', 'skills', 'shared-skill', 'SKILL.md'),
      ['---', 'name: shared-skill', 'description: Shared skill description', '---', '', '# Shared Skill', ''].join('\n'),
    );
    writeFileSync(join(repoRoot, 'profiles', 'shared', 'agent', 'skills', 'shared-skill', 'references', 'notes.md'), '# Notes\n');
    writeFileSync(
      join(repoRoot, 'profiles', 'datadog', 'agent', 'skills', 'dd-skill', 'SKILL.md'),
      ['---', 'name: dd-skill', 'description: Datadog skill description', '---', '', '# Datadog Skill', ''].join('\n'),
    );
    writeFileSync(join(repoRoot, 'profiles', 'datadog', 'agent', 'skills', 'dd-skill', 'scripts', 'run.sh'), '#!/bin/sh\n');
    writeFileSync(
      join(repoRoot, 'profiles', 'datadog', 'agent', 'memory', 'runpod.md'),
      ['---', 'id: runpod', 'title: "Runpod Notes"', 'summary: "GPU host runbook"', 'tags:', '  - infra', 'updated: 2026-03-10', '---', '', '# Runpod', ''].join('\n'),
    );

    const context = resolveMemoryProfileContext(repoRoot);
    const rootMenu = buildMemoryBrowserRootMenu(context);

    expect(rootMenu.title).toBe('Memory');
    expect(rootMenu.items.map((item) => item.label)).toEqual(['Skills', 'Memories folder', 'AGENTS.md']);

    const skillsMenu = rootMenu.items[0]!;
    expect(skillsMenu.kind).toBe('menu');
    const layerMenu = skillsMenu.kind === 'menu' ? skillsMenu.buildMenu() : undefined;
    expect(layerMenu?.items.map((item) => item.label)).toEqual(['shared', 'datadog']);

    const datadogSkills = layerMenu?.items.find((item) => item.label === 'datadog');
    expect(datadogSkills?.kind).toBe('menu');
    const datadogSkillsMenu = datadogSkills && datadogSkills.kind === 'menu' ? datadogSkills.buildMenu() : undefined;
    expect(datadogSkillsMenu?.items.map((item) => item.label)).toContain('dd-skill');

    const skillEntry = datadogSkillsMenu?.items.find((item) => item.label === 'dd-skill');
    expect(skillEntry?.description).toContain('Datadog skill description');
    expect(skillEntry?.kind).toBe('menu');
    const skillFilesMenu = skillEntry && skillEntry.kind === 'menu' ? skillEntry.buildMenu() : undefined;
    expect(skillFilesMenu?.items.map((item) => item.label)).toContain('SKILL.md');
    expect(skillFilesMenu?.items.map((item) => item.label)).toContain('scripts');

    const memoriesMenuItem = rootMenu.items[1]!;
    expect(memoriesMenuItem.kind).toBe('menu');
    const memoriesMenu = memoriesMenuItem.kind === 'menu' ? memoriesMenuItem.buildMenu() : undefined;
    expect(memoriesMenu?.items.some((item) => item.kind === 'file' && item.label === 'Runpod Notes')).toBe(true);

    const agentsMenuItem = rootMenu.items[2]!;
    expect(agentsMenuItem.kind).toBe('menu');
    const agentsMenu = agentsMenuItem.kind === 'menu' ? agentsMenuItem.buildMenu() : undefined;
    expect(agentsMenu?.items.map((item) => item.label)).toEqual(['shared', 'datadog']);
  });

  it('registers a /memory command and footer status entry for the TUI', async () => {
    let sessionStartHandler: ((event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, value: string | undefined) => void; theme: { fg: (tone: string, text: string) => string } } }) => Promise<void>) | undefined;
    let sessionShutdownHandler: ((event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, value: string | undefined) => void } }) => Promise<void>) | undefined;
    let memoryCommandHandler: ((args: string, ctx: { hasUI: boolean }) => Promise<void>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'session_start') {
          sessionStartHandler = handler as (event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, value: string | undefined) => void; theme: { fg: (tone: string, text: string) => string } } }) => Promise<void>;
        }

        if (eventName === 'session_shutdown') {
          sessionShutdownHandler = handler as (event: unknown, ctx: { hasUI: boolean; ui: { setStatus: (key: string, value: string | undefined) => void } }) => Promise<void>;
        }
      },
      registerCommand: (name: string, config: { handler: (args: string, ctx: { hasUI: boolean }) => Promise<void> }) => {
        if (name === 'memory') {
          memoryCommandHandler = config.handler;
        }
      },
      registerTool: vi.fn(),
    };

    memoryExtension(pi as never);
    expect(memoryCommandHandler).toBeDefined();
    expect(sessionStartHandler).toBeDefined();
    expect(sessionShutdownHandler).toBeDefined();

    const setStatus = vi.fn();
    await sessionStartHandler!({}, {
      hasUI: true,
      ui: {
        setStatus,
        theme: {
          fg: (_tone: string, text: string) => text,
        },
      },
    });

    expect(setStatus).toHaveBeenCalledWith('memory-browser', '🧠 /memory');

    await sessionShutdownHandler!({}, {
      hasUI: true,
      ui: {
        setStatus,
      },
    });

    expect(setStatus).toHaveBeenCalledWith('memory-browser', undefined);
  });
});
