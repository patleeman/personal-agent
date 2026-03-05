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
  activeWorkspaceDir?: string;
}): string {
  const lines = [
    'MEMORY_POLICY',
    `- active_profile: ${options.activeProfile}`,
    `- active_profile_dir: ${toDisplayPath(options.cwd, options.activeProfileDir)}`,
    `- repo_root: ${toDisplayPath(options.cwd, options.repoRoot)}`,
  ];

  if (options.requestedProfile !== options.activeProfile) {
    lines.push(`- requested_profile: ${options.requestedProfile}`);
    lines.push(`- note: requested profile was missing; using "${options.activeProfile}"`);
  }

  lines.push(
    '',
    'Profile memory write targets (edit these locations directly):',
    options.activeAgentsFile
      ? `- AGENTS.md edit target: ${toDisplayPath(options.cwd, options.activeAgentsFile)}`
      : '- AGENTS.md edit target: none (shared profile does not use AGENTS.md)',
    `- Skills dir: ${toDisplayPath(options.cwd, options.activeSkillsDir)}`,
  );

  if (options.activeWorkspaceDir) {
    lines.push(
      `- Workspace dir: ${toDisplayPath(options.cwd, options.activeWorkspaceDir)}`,
      `- Project context file template: ${toDisplayPath(options.cwd, join(options.activeWorkspaceDir, 'projects', '<project-slug>', 'PROJECT.md'))}`,
    );
  } else {
    lines.push('- Workspace dir: none (shared profile has no workspace)');
  }

  lines.push(
    '',
    'PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):',
    `- Docs folder: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs'))}`,
    `- Start with docs index: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'README.md'))}`,
    '- Then follow markdown cross-references to relevant pages.',
    '- When working on personal-agent features, read relevant docs first before implementing.',
    '',
    'Use profile-local AGENTS.md, skills, and workspace docs as the durable memory system.',
    '',
    'Memory handling rules:',
    '- When asked to update durable behavior/memory, edit the AGENTS.md edit target above.',
    '- Store stable behavior rules, durable facts, and role constraints in AGENTS.md.',
    '- Store reusable cross-project workflows and domain knowledge in skills.',
    '- Store project-specific briefs, runbooks, specs, and notes under workspace/projects/<project-slug>/.',
    '- For project work, read workspace/projects/<project-slug>/PROJECT.md first when present.',
    '- Do not write durable memory into profiles/shared/agent/AGENTS.md.',
    '- Do not use MEMORY.md files as durable memory.',
    '- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.',
    '- Read the workflow-learn-skill and workflow-skill-creator skills when creating new skills.',
  );

  return lines.join('\n');
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
      activeWorkspaceDir,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });
}
