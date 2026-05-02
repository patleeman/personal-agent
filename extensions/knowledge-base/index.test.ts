import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import knowledgeBaseExtension, { resolveKnowledgeContext } from './index';

const PROMPT_CATALOG_TEMPLATE = `# Identity & Goal

You are Patrick Lee's personal AI agent.

# Technical Context

## Profile Context
- active_profile: {{ active_profile }}
- active_profile_dir: {{ active_profile_dir }}
- repo_root: {{ repo_root }}
- vault_root: {{ vault_root }}
{% if requested_profile and requested_profile != active_profile %}
- requested_profile: {{ requested_profile }}
- note: requested profile was missing; using "{{ active_profile }}"
{% endif %}

## Write Targets
- AGENTS.md: {{ agents_edit_target }}
- Skills dir: {{ skills_dir }}
- Scheduled tasks dir: {{ tasks_dir }} (Note: Scheduled tasks belong here, not in shared notes).

## Documentation
- Docs folder: {{ docs_dir }}
- Docs index: {{ docs_index }}
- Internal skills folder: {{ feature_docs_dir }}
- Internal skills index: {{ feature_docs_index }}

{% if available_internal_skills %}
## Internal personal-agent feature skills
Built-in runtime guides for personal-agent features.

<available_internal_skills>
{% for skill in available_internal_skills %}
  <internal_skill id="{{ skill.name }}" title="{{ skill.title or skill.name }}" location="{{ skill.path }}">
    {{ skill.description }}
  </internal_skill>
{% endfor %}
</available_internal_skills>
{% endif %}

{% if available_skills %}
## Available Skills
<available_skills>
{% for skill in available_skills %}
  <skill id="{{ skill.name }}" location="{{ skill.path }}">
    {{ skill.description }}
  </skill>
{% endfor %}
</available_skills>
{% endif %}

## Knowledge Vault
Freeform markdown files live anywhere under the vault root.

- vault_root: {{ vault_root }}
`;

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

function writePromptCatalog(repoRoot: string): void {
  mkdirSync(join(repoRoot, 'prompt-catalog'), { recursive: true });
  writeFileSync(join(repoRoot, 'prompt-catalog', 'system.md'), PROMPT_CATALOG_TEMPLATE);
}

function writeProfileDirs(stateRoot: string, ...profiles: string[]): void {
  for (const profile of profiles) {
    mkdirSync(join(stateRoot, 'config', 'profiles', profile), { recursive: true });
  }
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
    writePromptCatalog(repoRoot);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'shared-skill', 'Shared skill available to every profile.', ['shared']);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'datadog-skill', 'Datadog-only skill available in the datadog profile.', ['datadog']);
    writeSkillNode(join(stateRoot, 'vault', '_skills'), 'default-skill', 'Default-only skill that should not appear for datadog.', ['default']);

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
    writePromptCatalog(repoRoot);

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
    expect(prompt).toContain('- requested_profile: missing-profile');
    expect(prompt).toContain('requested profile was missing');
    expect(prompt).toContain(`- AGENTS.md: ${join(stateRoot, 'vault', 'AGENTS.md')}`);
    expect(prompt).toContain(`- Scheduled tasks dir: ${join(stateRoot, 'sync', 'tasks')} (Note: Scheduled tasks belong here, not in shared notes).`);

    // Should still show knowledge vault section (without notes enumeration)
    expect(prompt).toContain('## Knowledge Vault');
    expect(prompt).not.toContain('## Shared Notes & Available Nodes');
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
  });

  it('renders NODE_POLICY for generic prompts', async () => {
    const repoRoot = createTempDir('memory-repo-');
    const stateRoot = createTempDir('memory-state-');
    process.env.PERSONAL_AGENT_REPO_ROOT = repoRoot;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';
    process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'vault');

    writeProfileDirs(stateRoot, 'shared', 'datadog');
    writePromptCatalog(repoRoot);

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
    writePromptCatalog(repoRoot);

    const context = resolveKnowledgeContext(repoRoot);
    expect(context.activeProfile).toBe('datadog');
    expect(context.layers.map((layer) => layer.name)).toEqual(['shared', 'datadog']);
    expect(context.activeAgentsFile).toBe(join(stateRoot, 'vault', 'AGENTS.md'));
    expect(context.activeSkillsDir).toBe(join(stateRoot, 'vault', 'skills'));
    expect(context.activeTasksDir).toBe(join(stateRoot, 'sync', 'tasks'));
  });
});
