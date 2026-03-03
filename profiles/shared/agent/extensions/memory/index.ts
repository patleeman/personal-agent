import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const DEFAULT_LOCAL_PROFILE_DIR = join(homedir(), '.config', 'personal-agent', 'local');

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

function resolveActiveProfile(): string {
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

function existingDir(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return statSync(path).isDirectory() ? resolve(path) : undefined;
  } catch {
    return undefined;
  }
}

function resolveLocalOverlayDir(): string | undefined {
  const explicit = process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR?.trim();
  const localBase = explicit && explicit.length > 0
    ? resolve(explicit)
    : DEFAULT_LOCAL_PROFILE_DIR;

  return existingDir(join(localBase, 'agent')) ?? existingDir(localBase);
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
  sharedProfileDir: string;
  localOverlayDir?: string;
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
    'Resource layering (low -> high priority):',
    `1. Shared profile: ${toDisplayPath(options.cwd, options.sharedProfileDir)}`,
    `2. Active profile (${options.activeProfile}): ${toDisplayPath(options.cwd, options.activeProfileDir)}`,
  );

  if (options.localOverlayDir) {
    lines.push(`3. Local overlay: ${toDisplayPath(options.cwd, options.localOverlayDir)}`);
  } else {
    lines.push('3. Local overlay: not present');
  }

  lines.push(
    'Conflict rule: higher layer overrides lower layer (local > active profile > shared).',
    '',
    'PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):',
    `- Main README: ${toDisplayPath(options.cwd, join(options.repoRoot, 'README.md'))}`,
    `- Docs index: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'README.md'))}`,
    `- CLI: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'cli.md'))}`,
    `- Configuration: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'configuration.md'))}`,
    `- Profile schema: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'profile-schema.md'))}`,
    `- Tasks: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'tasks.md'))}`,
    `- Gateway: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'gateway.md'))}`,
    `- Daemon architecture: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'daemon-architecture.md'))}`,
    `- Extensions: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'extensions.md'))}`,
    `- Architecture: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'architecture.md'))}`,
    `- Troubleshooting: ${toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'troubleshooting.md'))}`,
    '- When working on personal-agent features, read relevant docs first and follow markdown cross-references before implementing.',
    '',
    'Use AGENTS.md and skills as the only durable memory system.',
    '',
    'Memory locations:',
    `- Shared AGENTS.md: ${toDisplayPath(options.cwd, join(options.sharedProfileDir, 'AGENTS.md'))}`,
    `- Active AGENTS.md: ${toDisplayPath(options.cwd, join(options.activeProfileDir, 'AGENTS.md'))}`,
    `- Shared skills: ${toDisplayPath(options.cwd, join(options.sharedProfileDir, 'skills'))}`,
    `- Active skills: ${toDisplayPath(options.cwd, join(options.activeProfileDir, 'skills'))}`,
  );

  if (options.localOverlayDir) {
    lines.push(
      `- Local AGENTS.md: ${toDisplayPath(options.cwd, join(options.localOverlayDir, 'AGENTS.md'))}`,
      `- Local skills: ${toDisplayPath(options.cwd, join(options.localOverlayDir, 'skills'))}`,
    );
  }

  lines.push(
    '',
    'Memory handling rules:',
    '- You have carte blanche to create, update, reorganize, or remove AGENTS.md and skills for the active role.',
    '- Store stable behavior rules, durable facts, and role constraints in AGENTS.md.',
    '- Store reusable workflows, runbooks, and domain knowledge in skills or modify existing skills.',
    '- Prefer active profile files for role-specific memory; promote broadly reusable memory to shared files.',
    '- Use local overlay files only for machine-specific non-secret overrides when needed.',
    '- Do not use MEMORY.md files as durable memory.',
    '- Never store secrets, credentials, API keys, tokens, or temporary/session-only notes.',
    '- Read the workflow-learn-skill and workflow-skill-creator skills when creating new skills.'
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
    const requestedProfile = resolveActiveProfile();
    const sharedProfileDir = resolveProfileDir(repoRoot, 'shared');

    const requestedProfileDir = resolveProfileDir(repoRoot, requestedProfile);
    const activeProfile = existsSync(requestedProfileDir) ? requestedProfile : 'shared';
    const activeProfileDir = activeProfile === requestedProfile
      ? requestedProfileDir
      : sharedProfileDir;
    const localOverlayDir = resolveLocalOverlayDir();

    const memoryPolicy = buildMemoryPolicyBlock({
      cwd: ctx.cwd,
      repoRoot,
      requestedProfile,
      activeProfile,
      activeProfileDir,
      sharedProfileDir,
      localOverlayDir,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });
}
