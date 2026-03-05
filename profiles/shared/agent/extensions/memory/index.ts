import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!PROFILE_NAME_PATTERN.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function resolveRepoRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  const extensionDir = dirname(fileURLToPath(import.meta.url));
  return resolve(extensionDir, '../../../../..');
}

function resolveRequestedProfile(): string {
  const envCandidates = [
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
    process.env.PERSONAL_AGENT_PROFILE,
  ];

  for (const candidate of envCandidates) {
    const sanitized = sanitizeProfileName(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  return 'shared';
}

function resolveProfileDir(repoRoot: string, profile: string): string {
  return join(repoRoot, 'profiles', profile, 'agent');
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  if (!displayed || displayed.startsWith('..')) {
    return path;
  }

  return displayed.replace(/\\/g, '/');
}

function buildMemoryPolicyBlock(options: {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeWorkspaceDir?: string;
}): string {
  const activeProfileDirDisplay = toDisplayPath(options.cwd, options.activeProfileDir);
  const repoRootDisplay = toDisplayPath(options.cwd, options.repoRoot);
  const activeAgentsTarget = options.activeAgentsFile
    ? toDisplayPath(options.cwd, options.activeAgentsFile)
    : 'none (shared profile does not use AGENTS.md)';
  const activeSkillsDirDisplay = toDisplayPath(options.cwd, options.activeSkillsDir);
  const activeTasksDirDisplay = options.activeTasksDir
    ? toDisplayPath(options.cwd, options.activeTasksDir)
    : 'none (shared profile does not use profile task dir)';

  const requestedProfileSection = options.requestedProfile !== options.activeProfile
    ? `- requested_profile: ${options.requestedProfile}\n- note: requested profile was missing; using "${options.activeProfile}"\n`
    : '';

  const workspaceSection = options.activeWorkspaceDir
    ? `- Workspace dir: ${toDisplayPath(options.cwd, options.activeWorkspaceDir)}\n- Project context file template: ${toDisplayPath(options.cwd, join(options.activeWorkspaceDir, 'projects', '<project-slug>', 'PROJECT.md'))}`
    : '- Workspace dir: none (shared profile has no workspace)';

  const docsDirDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs'));
  const docsIndexDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'README.md'));

  return `MEMORY_POLICY

## Active profile context
- active_profile: ${options.activeProfile}
- active_profile_dir: ${activeProfileDirDisplay}
- repo_root: ${repoRootDisplay}
${requestedProfileSection}
## Profile memory write targets
Profile memory write targets (edit these locations directly):
- AGENTS.md edit target: ${activeAgentsTarget}
- Skills dir: ${activeSkillsDirDisplay}
- Scheduled tasks dir: ${activeTasksDirDisplay}
- Scheduled tasks should live adjacent to workspace (not inside workspace).
${workspaceSection}

## PA documentation
PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):
- Docs folder: ${docsDirDisplay}
- Start with docs index: ${docsIndexDisplay}
- Then follow markdown cross-references to relevant pages.
- When working on personal-agent features, read relevant docs first before implementing.

## Durable memory policy
Use profile-local AGENTS.md, skills, and workspace docs as the durable memory system.

## Memory handling rules
Memory handling rules:
- When asked to update durable behavior/memory, edit the AGENTS.md edit target above.
- AGENTS.md should stay high-level: user facts, durable role constraints, and broad operating policies.
- Store stable behavior rules, durable facts, and role constraints in AGENTS.md.
- Do not put tool/version-specific tactics, temporary issue notes, or narrow workflows in AGENTS.md.
- Store reusable cross-project workflows and domain knowledge in skills.
- Skills are for workflows and tactics you expect to repeat.
- Put tool-specific runbooks and version-specific quirks in skills (for example Task Factory behavior notes).
- Store project-specific briefs, runbooks, specs, and notes under workspace/projects/<project-slug>/.
- Projects are for repo-specific context and evolving implementation notes.
- For project work, read workspace/projects/<project-slug>/PROJECT.md first when present.
- If AGENTS.md contains narrow operational details, migrate them to skills/project docs and simplify AGENTS.md.
- Do not write durable memory into profiles/shared/agent/AGENTS.md.
- Do not use MEMORY.md files as durable memory.
- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.
- Read the workflow-learn-skill and workflow-skill-creator skills when creating new skills.`;
}

export default function memoryExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0) {
      return;
    }

    if (prompt.startsWith('/')) {
      return;
    }

    const repoRoot = resolveRepoRoot();
    const requestedProfile = resolveRequestedProfile();
    const requestedProfileDir = resolveProfileDir(repoRoot, requestedProfile);
    const sharedProfileDir = resolveProfileDir(repoRoot, 'shared');

    const activeProfile = existsSync(requestedProfileDir) ? requestedProfile : 'shared';
    const activeProfileDir = activeProfile === requestedProfile
      ? requestedProfileDir
      : sharedProfileDir;

    const activeAgentsFile = activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'AGENTS.md');

    const activeSkillsDir = join(activeProfileDir, 'skills');

    const activeTasksDir = activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'tasks');

    const activeWorkspaceDir = activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'workspace');

    const memoryPolicy = buildMemoryPolicyBlock({
      cwd: ctx.cwd,
      repoRoot,
      requestedProfile,
      activeProfile,
      activeProfileDir,
      activeAgentsFile,
      activeSkillsDir,
      activeTasksDir,
      activeWorkspaceDir,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });
}
