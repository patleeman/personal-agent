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
  activeMemoryDir?: string;
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

  const memorySection = options.activeMemoryDir
    ? `- Memory dir: ${toDisplayPath(options.cwd, options.activeMemoryDir)}\n- Memory doc template: ${toDisplayPath(options.cwd, join(options.activeMemoryDir, '<doc-id>.md'))}`
    : '- Memory dir: none (shared profile has no memory dir)';

  const memoryRetrievalSection = options.activeMemoryDir
    ? `- At task start, apply the active AGENTS policy first, then load only the skills and memory docs relevant to the current request.\n- Retrieval order: AGENTS.md for durable policy/facts, skills for reusable workflows/tactics, memory docs for profile/project context.\n- Prefer targeted retrieval over broad scans; do not read the whole memory directory unless the task genuinely requires it.\n- Prefer \`pa memory list --profile ${options.activeProfile}\` to inventory available memory docs.\n- Prefer \`pa memory find --profile ${options.activeProfile} --text <query>\` and/or \`--tag\`, \`--type\`, \`--status\` to locate relevant docs quickly.\n- Use \`pa memory show <id> --profile ${options.activeProfile}\` to inspect a specific memory doc by id.\n- Use CLI discovery first, then use the read tool on the exact file before editing.\n- Use \`pa memory new <id> --profile ${options.activeProfile} ...\` to create a new memory doc with valid frontmatter when needed.\n- Use \`pa memory lint --profile ${options.activeProfile}\` after creating or heavily editing memory docs.`
    : `- At task start, apply the active AGENTS policy first, then load only the skills relevant to the current request.\n- Retrieval order: AGENTS.md for durable policy/facts, then skills for reusable workflows/tactics.\n- Shared profile has no profile-local memory docs.`;

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
- Scheduled tasks should live adjacent to memory (not inside memory).
${memorySection}

## PA documentation
PA documentation (read when the user asks about pa/personal-agent, CLI, daemon, gateway, tasks, profiles, or extensions):
- Docs folder: ${docsDirDisplay}
- Start with docs index: ${docsIndexDisplay}
- Then follow markdown cross-references to relevant pages.
- When working on personal-agent features, read relevant docs first before implementing.

## Durable memory policy
Use profile-local AGENTS.md, skills, and memory docs as the durable memory system.

## Memory handling rules
Memory handling rules:
- When asked to update durable behavior/memory, edit the AGENTS.md edit target above.
- AGENTS.md should stay high-level: user facts, durable role constraints, and broad operating policies.
- Store stable behavior rules, durable facts, and role constraints in AGENTS.md.
- Do not put tool/version-specific tactics, temporary issue notes, or narrow workflows in AGENTS.md.
- Store reusable cross-project workflows and domain knowledge in skills.
- Skills are for workflows and tactics you expect to repeat.
- Put tool-specific runbooks and version-specific quirks in skills (for example Task Factory behavior notes).
- Store profile-specific briefs, runbooks, specs, and notes under memory/*.md with YAML frontmatter.
- Keep memory docs flat (single folder) for predictable retrieval.
${memoryRetrievalSection}
- Keep non-markdown automation state outside memory docs (for example under agent/state/).
- If AGENTS.md contains narrow operational details, migrate them to skills/memory docs and simplify AGENTS.md.
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

    const activeMemoryDir = activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'memory');

    const memoryPolicy = buildMemoryPolicyBlock({
      cwd: ctx.cwd,
      repoRoot,
      requestedProfile,
      activeProfile,
      activeProfileDir,
      activeAgentsFile,
      activeSkillsDir,
      activeTasksDir,
      activeMemoryDir,
    });

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });
}
