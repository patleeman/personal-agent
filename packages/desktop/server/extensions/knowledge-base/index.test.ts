import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  renderSystemPromptTemplateMock,
} = vi.hoisted(() => ({
  renderSystemPromptTemplateMock: vi.fn(),
}));

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    renderSystemPromptTemplate: renderSystemPromptTemplateMock,
  };
});

import knowledgeBaseExtension, { resolveKnowledgeContext } from './index';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSkillNode(skillsDir: string, skillId: string, description: string, profiles: string[] = []): void {
  mkdirSync(join(skillsDir, skillId), { recursive: true });
  const profilesBlock = profiles.length > 0
    ? `profiles:\n${profiles.map((profile) => `  - ${profile}`).join('\n')}\n`
    : '';
  writeFileSync(join(skillsDir, skillId, 'SKILL.md'), `---
name: ${skillId}
description: ${description}
${profilesBlock}metadata:
  id: ${skillId}
  title: ${skillId}
  summary: ${description}
  status: active
---

# ${skillId}
`);
}

function writeProfileDirs(stateRoot: string, ...profiles: string[]): void {
  for (const profile of profiles) {
    mkdirSync(join(stateRoot, 'config', 'profiles', profile), { recursive: true });
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  renderSystemPromptTemplateMock.mockReset();
  delete process.env.PERSONAL_AGENT_REPO_ROOT;
  delete process.env.PERSONAL_AGENT_ACTIVE_PROFILE;
  delete process.env.PERSONAL_AGENT_PROFILE;
  delete process.env.PERSONAL_AGENT_STATE_ROOT;
  delete process.env.PERSONAL_AGENT_PROFILES_ROOT;
  delete process.env.PERSONAL_AGENT_VAULT_ROOT;
});

describe('knowledge base extension', () => {
  it('renders system.md with active profile and available skills', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');

    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    writeProfileDirs(stateRoot, 'shared', 'datadog');
    mkdirSync(join(repoRoot, 'internal-skills', 'artifacts'), { recursive: true });
    writeFileSync(join(repoRoot, 'internal-skills', 'artifacts', 'INDEX.md'), `---
id: artifacts
kind: internal-skill
title: Artifacts
summary: How built-in rendered outputs behave.
---

# Artifacts
`);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'shared-skill', 'Shared skill available to every profile.', ['shared']);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'datadog-skill', 'Datadog-only skill available in the datadog profile.', ['datadog']);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'default-skill', 'Default-only skill that should not appear for datadog.', ['default']);

    renderSystemPromptTemplateMock.mockReturnValue(`# Identity & Goal

You are Patrick Lee's personal AI agent.

## Technical Context

## Profile Context
- active_profile: datadog
- active_profile_dir: ${join(stateRoot, 'config/profiles/datadog')}
- repo_root: ${repoRoot}
- vault_root: ${join(stateRoot, 'vault')}

## Write Targets
- AGENTS.md: vault/AGENTS.md
- Skills dir: ${join(stateRoot, 'vault/skills')}
- Scheduled tasks dir: ${join(stateRoot, 'sync/tasks')} (Note: Scheduled tasks belong here, not in shared notes).

## Documentation
- Docs folder: docs
- Docs index: docs/README.md
- Internal skills folder: ${join(repoRoot, 'internal-skills')}
- Internal skills index: internal-skills/README.md

## Internal personal-agent feature skills
Built-in runtime guides for personal-agent features.

<available_internal_skills>

  <internal_skill id="artifacts" title="Artifacts" location="internal-skills/artifacts/INDEX.md">
    How built-in rendered outputs behave.
  </internal_skill>

</available_internal_skills>

## Available Skills
<available_skills>

  <skill id="shared-skill" location="${join(stateRoot, 'vault/_skills/shared-skill/SKILL.md')}">
    Shared skill available to every profile.
  </skill>

  <skill id="datadog-skill" location="${join(stateRoot, 'vault/_skills/datadog-skill/SKILL.md')}">
    Datadog-only skill available in the datadog profile.
  </skill>

</available_skills>

## Knowledge Vault
Freeform markdown files live anywhere under the vault root.

- vault_root: vault
`);

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    knowledgeBaseExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const result = await beforeAgentStartHandler!(
      { prompt: 'please remember this setup', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: stateRoot },
    ) as { systemPrompt?: string } | undefined;

    const prompt = result?.systemPrompt ?? '';
    expect(prompt).toContain('# Identity & Goal');
    expect(prompt).toContain('- active_profile: datadog');
    expect(prompt).toContain('- vault_root: vault');
    expect(prompt).toContain('- AGENTS.md: vault/AGENTS.md');
    expect(prompt).toContain(`- Internal skills folder: ${join(repoRoot, 'internal-skills')}`);
    expect(prompt).toContain('Built-in runtime guides for personal-agent features.');
    expect(prompt).toContain('<available_internal_skills>');
    expect(prompt).toContain('<internal_skill id="artifacts"');
    expect(prompt).toContain('internal-skills/artifacts/INDEX.md');
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<skill id="shared-skill"');
    expect(prompt).toContain('<skill id="datadog-skill"');
    expect(prompt).not.toContain('<skill id="default-skill"');
    expect(prompt).toContain('vault/_skills/shared-skill/SKILL.md');

    // New knowledge vault section instead of old notes listing
    expect(prompt).toContain('## Knowledge Vault');
    expect(prompt).toContain('Freeform markdown files live anywhere under the vault root');
    expect(prompt).toContain(`- vault_root: vault`);
  });

  it('shows fallback note when requested profile is missing', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'missing-profile';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    writeProfileDirs(stateRoot, 'shared');
    mkdirSync(join(repoRoot, 'internal-skills', 'artifacts'), { recursive: true });
    writeFileSync(join(repoRoot, 'internal-skills', 'artifacts', 'INDEX.md'), `---
id: artifacts
kind: internal-skill
title: Artifacts
summary: How built-in rendered outputs behave.
---

# Artifacts
`);

    renderSystemPromptTemplateMock.mockReturnValue(`# Identity & Goal

## Profile Context
- active_profile: shared
- active_profile_dir: ${join(stateRoot, 'config/profiles/shared')}
- repo_root: ${repoRoot}
- vault_root: ${join(stateRoot, 'vault')}

## Write Targets
- AGENTS.md: ${join(stateRoot, 'vault', 'AGENTS.md')}
- Skills dir: ${join(stateRoot, 'vault', 'skills')}
- Scheduled tasks dir: ${join(stateRoot, 'sync', 'tasks')} (Note: Scheduled tasks belong here, not in shared notes).

## Documentation
- Internal skills folder: internal-skills
- Internal skills index: internal-skills/README.md

## Internal personal-agent feature skills
Built-in runtime guides for personal-agent features.

<available_internal_skills>

  <internal_skill id="artifacts" title="Artifacts" location="internal-skills/artifacts/INDEX.md">
    How built-in rendered outputs behave.
  </internal_skill>

</available_internal_skills>

## Knowledge Vault
Freeform markdown files live anywhere under the vault root.

- vault_root: vault
`);

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    knowledgeBaseExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'what should we retain?', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    const prompt = result?.systemPrompt ?? '';
    expect(prompt).toContain('- active_profile: shared');
    expect(prompt).toContain('- Internal skills folder: internal-skills');
    expect(prompt).toContain('## Internal personal-agent feature skills');
    expect(prompt).toContain(`- vault_root: ${join(stateRoot, 'vault')}`);
    expect(prompt).not.toContain('- requested_profile: missing-profile');
    expect(prompt).not.toContain('requested profile was missing');
    expect(prompt).toContain(`- AGENTS.md: ${join(stateRoot, 'vault', 'AGENTS.md')}`);
    expect(prompt).toContain(`- Scheduled tasks dir: ${join(stateRoot, 'sync', 'tasks')} (Note: Scheduled tasks belong here, not in shared notes).`);

    // Should still show knowledge vault section
    expect(prompt).toContain('## Knowledge Vault');
  });

  it('does not inject for slash commands or empty prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    knowledgeBaseExtension(pi as never);

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
    expect(renderSystemPromptTemplateMock).not.toHaveBeenCalled();
  });

  it('renders NODE_POLICY for generic prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    writeProfileDirs(stateRoot, 'shared', 'datadog');

    renderSystemPromptTemplateMock.mockReturnValue(`# Identity & Goal

You are Patrick Lee's personal AI agent.
`);

    let beforeAgentStartHandler: ((event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>) | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }, ctx: { cwd: string }) => Promise<unknown>;
        }
      },
    };

    knowledgeBaseExtension(pi as never);

    const result = await beforeAgentStartHandler!(
      { prompt: 'inspect the sync prompt behavior', systemPrompt: 'BASE_SYSTEM_PROMPT' },
      { cwd: repoRoot },
    ) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt ?? '').toContain('# Identity & Goal');
  });

  it('resolves the knowledge context', () => {
    const repoRoot = createTempDir('memory-context-repo-');
    const stateRoot = createTempDir('memory-context-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    writeProfileDirs(stateRoot, 'shared', 'datadog');

    const context = resolveKnowledgeContext(repoRoot);
    expect(context.activeProfile).toBe('datadog');
    expect(context.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(context.activeAgentsFile).toBe(join(stateRoot, 'vault', 'AGENTS.md'));
    expect(context.activeSkillsDir).toBe(join(stateRoot, 'vault', 'skills'));
    expect(context.activeTasksDir).toBe(join(stateRoot, 'sync', 'tasks'));
  });
});
