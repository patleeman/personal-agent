import { join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  renderPromptCatalogTemplate,
  requirePromptCatalogEntryFromExtension,
  resolveRepoRootFromExtension,
} from '../_shared/prompt-catalog.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface MemoryProfileLayer {
  name: string;
  agentDir: string;
}

export interface MemoryProfileContext {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  layers: MemoryProfileLayer[];
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeMemoryDir?: string;
}

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
  return resolveRepoRootFromExtension(import.meta.url);
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

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
}

function getDefaultStateRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return join(resolve(expandHomePath(xdgStateHome.trim())), 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveProfilesRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_PROFILES_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return join(getDefaultStateRoot(), 'profiles');
}

function resolveProfileDir(profilesRoot: string, profile: string): string {
  return join(profilesRoot, profile, 'agent');
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  if (!displayed || displayed.startsWith('..')) {
    return path;
  }

  return displayed.replace(/\\/g, '/');
}

export function resolveMemoryProfileContext(cwd: string): MemoryProfileContext {
  const repoRoot = resolveRepoRoot();
  const profilesRoot = resolveProfilesRoot();
  const requestedProfile = resolveRequestedProfile();
  const requestedProfileDir = resolveProfileDir(profilesRoot, requestedProfile);
  const sharedProfileDir = resolveProfileDir(profilesRoot, 'shared');

  const activeProfile = requestedProfile === 'shared' || existsSync(requestedProfileDir)
    ? requestedProfile
    : 'shared';
  const activeProfileDir = activeProfile === 'shared'
    ? sharedProfileDir
    : requestedProfileDir;

  const layers: MemoryProfileLayer[] = [
    { name: 'shared', agentDir: sharedProfileDir },
  ];

  if (activeProfile !== 'shared') {
    layers.push({ name: activeProfile, agentDir: activeProfileDir });
  }

  return {
    cwd,
    repoRoot,
    requestedProfile,
    activeProfile,
    activeProfileDir,
    layers,
    activeAgentsFile: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'AGENTS.md'),
    activeSkillsDir: join(activeProfileDir, 'skills'),
    activeTasksDir: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'tasks'),
    activeMemoryDir: activeProfile === 'shared'
      ? undefined
      : join(activeProfileDir, 'memory'),
  };
}

function buildMemoryTemplateVariables(options: {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeMemoryDir?: string;
}): Record<string, string> {
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
    ? `- At task start, apply the active AGENTS policy first, then load only the skills and memory docs relevant to the current request.\n- Retrieval order: AGENTS.md for durable policy/facts, skills for reusable workflows/tactics, memory docs for profile/project context.\n- Prefer targeted retrieval over broad scans; do not read the whole memory directory unless the task genuinely requires it.\n- Prefer \`pa memory list --profile ${options.activeProfile}\` to inventory available memory docs.\n- Prefer \`pa memory find --profile ${options.activeProfile} --text <query>\` and/or \`--tag\`, \`--type\`, \`--status\` to locate relevant docs quickly.\n- Use \`pa memory show <id> --profile ${options.activeProfile}\` to inspect a specific memory doc by id.\n- Use \`pa memory new <id> --profile ${options.activeProfile} ...\` to create a new memory doc with valid frontmatter when needed.\n- Use \`pa memory lint --profile ${options.activeProfile}\` after creating or heavily editing memory docs.`
    : '- Shared profile has no profile-local memory docs; rely on shared skills and repo docs instead.';

  const docsDirDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs'));
  const docsIndexDisplay = toDisplayPath(options.cwd, join(options.repoRoot, 'docs', 'README.md'));

  return {
    active_profile: options.activeProfile,
    active_profile_dir: activeProfileDirDisplay,
    repo_root: repoRootDisplay,
    requested_profile_section: requestedProfileSection,
    agents_edit_target: activeAgentsTarget,
    skills_dir: activeSkillsDirDisplay,
    tasks_dir: activeTasksDirDisplay,
    memory_section: memorySection,
    docs_dir: docsDirDisplay,
    docs_index: docsIndexDisplay,
    memory_retrieval_section: memoryRetrievalSection,
  };
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
  const template = requirePromptCatalogEntryFromExtension(import.meta.url, 'runtime/memory.md');
  return renderPromptCatalogTemplate(template, buildMemoryTemplateVariables(options));
}

function buildMemoryOperationsReminder(options: {
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
  const template = requirePromptCatalogEntryFromExtension(import.meta.url, 'reminders/memory-operations.md');
  return renderPromptCatalogTemplate(template, buildMemoryTemplateVariables(options));
}

function isMemorySpecificPrompt(prompt: string): boolean {
  return /\b(memory|remember|persist|retain|agents\.md|durable memory|memory maintenance)\b/i.test(prompt);
}

export default function memoryExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0 || prompt.startsWith('/')) {
      return;
    }

    const context = resolveMemoryProfileContext(ctx.cwd);
    const memoryPolicy = buildMemoryPolicyBlock({
      cwd: context.cwd,
      repoRoot: context.repoRoot,
      requestedProfile: context.requestedProfile,
      activeProfile: context.activeProfile,
      activeProfileDir: context.activeProfileDir,
      activeAgentsFile: context.activeAgentsFile,
      activeSkillsDir: context.activeSkillsDir,
      activeTasksDir: context.activeTasksDir,
      activeMemoryDir: context.activeMemoryDir,
    });

    const result: {
      systemPrompt: string;
      message?: {
        customType: string;
        content: string;
        display: false;
      };
    } = {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };

    if (isMemorySpecificPrompt(prompt)) {
      result.message = {
        customType: 'memory-operations-reminder',
        content: buildMemoryOperationsReminder({
          cwd: context.cwd,
          repoRoot: context.repoRoot,
          requestedProfile: context.requestedProfile,
          activeProfile: context.activeProfile,
          activeProfileDir: context.activeProfileDir,
          activeAgentsFile: context.activeAgentsFile,
          activeSkillsDir: context.activeSkillsDir,
          activeTasksDir: context.activeTasksDir,
          activeMemoryDir: context.activeMemoryDir,
        }),
        display: false,
      };
    }

    return result;
  });
}
