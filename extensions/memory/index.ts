import { basename, dirname, join, relative, resolve } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

function resolveMemoryDir(profilesRoot: string): string {
  return join(dirname(profilesRoot), 'notes');
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  if (!displayed || displayed.startsWith('..')) {
    return path;
  }

  return displayed.replace(/\\/g, '/');
}

interface MemoryDefinition {
  name: string;
  description: string;
  path: string;
}

function extractFrontmatterBlock(content: string): string | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  return match?.[1] ?? null;
}

function parseMarkdownFrontmatter(content: string): Record<string, string> {
  const body = extractFrontmatterBlock(content);
  if (!body) {
    return {};
  }

  const output: Record<string, string> = {};

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!key || !value) {
      continue;
    }

    output[key] = value;
  }

  return output;
}

function listAvailableMemories(memoryDir: string | undefined): MemoryDefinition[] {
  if (!memoryDir || !existsSync(memoryDir)) {
    return [];
  }

  const entries = readdirSync(memoryDir, { withFileTypes: true });
  const discovered: MemoryDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const memoryFile = join(memoryDir, entry.name, 'INDEX.md');
    if (!existsSync(memoryFile)) {
      continue;
    }

    try {
      const content = readFileSync(memoryFile, 'utf-8');
      const frontmatter = parseMarkdownFrontmatter(content);
      const kind = (frontmatter.kind ?? '').trim().toLowerCase();
      if (kind !== 'note') {
        continue;
      }

      const name = (frontmatter.id ?? basename(entry.name)).trim();
      const description = (frontmatter.summary ?? frontmatter.description ?? '').trim();
      if (!name || !description) {
        continue;
      }

      discovered.push({
        name,
        description,
        path: memoryFile,
      });
    } catch {
      // Ignore malformed note nodes in the prompt-time hint list.
    }
  }

  return discovered.sort((left, right) => left.name.localeCompare(right.name));
}

function buildAvailableMemoriesSection(cwd: string, memoryDir: string | undefined): string {
  const memories = listAvailableMemories(memoryDir);
  if (memories.length === 0) {
    return 'No shared note nodes found.';
  }

  return [
    '<available_notes>',
    ...memories.map((memory) => [
      `  <note id="${memory.name}" location="${toDisplayPath(cwd, memory.path)}">`,
      `    ${memory.description}`,
      '  </note>',
    ].join('\n')),
    '</available_notes>',
    'Notes are durable knowledge nodes. Read the matching INDEX.md when the user refers to that area, then follow relative references inside the note directory.',
  ].join('\n');
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
    activeMemoryDir: resolveMemoryDir(profilesRoot),
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
    ? `- Shared notes dir: ${toDisplayPath(options.cwd, options.activeMemoryDir)}\n- Note node template: ${toDisplayPath(options.cwd, join(options.activeMemoryDir, '<note-id>', 'INDEX.md'))}`
    : '- Shared notes dir: unavailable';

  const memoryRetrievalSection = options.activeMemoryDir
    ? '- Load only the AGENTS, skills, and note nodes relevant to the request.\n- Retrieval order: AGENTS.md for durable policy, skills for reusable workflows, shared note nodes for durable knowledge.\n- Prefer targeted lookup over broad scans; do not read the whole notes directory unless the task genuinely requires it.\n- Prefer the memory tool when available; otherwise use `pa memory list/find/show/new/lint` to inspect note nodes.\n- Find/show before new; lint after creating or heavily editing note nodes.'
    : '- Shared note nodes are unavailable; rely on AGENTS, skills, and repo docs instead.';

  const availableMemoriesSection = buildAvailableMemoriesSection(options.cwd, options.activeMemoryDir);

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
    available_memories_section: availableMemoriesSection,
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

    return {
      systemPrompt: `${event.systemPrompt}\n\n${memoryPolicy}`,
    };
  });
}
