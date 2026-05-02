import { join, relative } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  getDurableAgentFilePath,
  getDurableSkillsDir,
  getDurableTasksDir,
  getProfilesRoot,
  getVaultRoot,
  loadUnifiedNodes,
} from '@personal-agent/core';
import {
  renderSystemPromptTemplate,
} from '@personal-agent/core';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface KnowledgeLayer {
  name: string;
  agentDir: string;
}

export interface KnowledgeContext {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  layers: KnowledgeLayer[];
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
}

interface ResourceDefinition {
  name: string;
  title?: string;
  description: string;
  path: string;
}

type LoadedNode = ReturnType<typeof loadUnifiedNodes>['nodes'][number];

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim();
  return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}

function resolveRepoRoot(): string {
  // The repo root is set at startup in PERSONAL_AGENT_REPO_ROOT.
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit) return explicit;
  return process.cwd();
}

function resolveRequestedProfile(): string {
  for (const candidate of [process.env.PERSONAL_AGENT_ACTIVE_PROFILE, process.env.PERSONAL_AGENT_PROFILE]) {
    const sanitized = sanitizeProfileName(candidate);
    if (sanitized) return sanitized;
  }
  return 'shared';
}

function resolveProfilesRoot(): string {
  return getProfilesRoot();
}

function resolveProfileDir(profilesRoot: string, profile: string): string {
  return join(profilesRoot, profile);
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  return displayed && !displayed.startsWith('..') ? displayed.replace(/\\/g, '/') : path;
}

function listAvailableSkills(activeProfile: string, nodes: LoadedNode[]): ResourceDefinition[] {
  const normalizedProfile = activeProfile.trim().toLowerCase();
  return nodes
    .filter((node) => node.kinds.includes('skill'))
    .filter((node) => node.profiles.length === 0 || node.profiles.some((value) => {
      const normalizedValue = value.toLowerCase();
      return normalizedValue === normalizedProfile || normalizedValue === 'shared';
    }))
    .map((node) => ({
      name: node.id,
      description: (node.summary || node.description || '').trim(),
      path: node.filePath,
    }))
    .filter((node) => node.description.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseFrontmatterValue(contents: string, key: string): string | undefined {
  const match = contents.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function listAvailableInternalSkills(repoRoot: string): ResourceDefinition[] {
  const featureDocsDir = join(repoRoot, 'internal-skills');
  if (!existsSync(featureDocsDir)) {
    return [];
  }

  return readdirSync(featureDocsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(featureDocsDir, entry.name, 'INDEX.md');
      if (!existsSync(path)) {
        return null;
      }

      const contents = readFileSync(path, 'utf-8');
      const title = parseFrontmatterValue(contents, 'title')
        ?? contents.match(/^#\s+(.+)$/m)?.[1]?.trim()
        ?? entry.name;
      const description = parseFrontmatterValue(contents, 'summary')
        ?? contents
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('---') && !line.includes(': '))
        ?? '';

      return {
        name: parseFrontmatterValue(contents, 'id') ?? entry.name,
        title,
        description,
        path,
      };
    })
    .filter((entry): entry is ResourceDefinition => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveKnowledgeContext(cwd: string): KnowledgeContext {
  const repoRoot = resolveRepoRoot();
  const profilesRoot = resolveProfilesRoot();
  const requestedProfile = resolveRequestedProfile();
  const requestedProfileDir = resolveProfileDir(profilesRoot, requestedProfile);
  const sharedProfileDir = resolveProfileDir(profilesRoot, 'shared');
  const activeProfile = requestedProfile === 'shared' || existsSync(requestedProfileDir)
    ? requestedProfile
    : 'shared';
  const activeProfileDir = activeProfile === 'shared' ? sharedProfileDir : requestedProfileDir;
  const layers: KnowledgeLayer[] = [{ name: 'shared', agentDir: sharedProfileDir }];
  if (activeProfile !== 'shared') layers.push({ name: activeProfile, agentDir: activeProfileDir });

  return {
    cwd,
    repoRoot,
    requestedProfile,
    activeProfile,
    activeProfileDir,
    layers,
    activeAgentsFile: getDurableAgentFilePath(getVaultRoot()),
    activeSkillsDir: getDurableSkillsDir(),
    activeTasksDir: getDurableTasksDir(),
  };
}

function buildTemplateVariables(cwd: string, context: ReturnType<typeof resolveKnowledgeContext>) {
  const { nodes } = loadUnifiedNodes();

  return {
    active_profile: context.activeProfile,
    active_profile_dir: toDisplayPath(cwd, context.activeProfileDir),
    repo_root: toDisplayPath(cwd, context.repoRoot),
    vault_root: toDisplayPath(cwd, getVaultRoot()),
    requested_profile: context.requestedProfile,
    agents_edit_target: toDisplayPath(cwd, context.activeAgentsFile ?? getDurableAgentFilePath(getVaultRoot())),
    skills_dir: toDisplayPath(cwd, context.activeSkillsDir),
    tasks_dir: context.activeTasksDir ? toDisplayPath(cwd, context.activeTasksDir) : 'none (shared profile does not use profile task dir)',
    docs_dir: toDisplayPath(cwd, join(context.repoRoot, 'docs')),
    docs_index: toDisplayPath(cwd, join(context.repoRoot, 'docs', 'README.md')),
    feature_docs_dir: toDisplayPath(cwd, join(context.repoRoot, 'internal-skills')),
    feature_docs_index: toDisplayPath(cwd, join(context.repoRoot, 'internal-skills', 'README.md')),
    available_internal_skills: listAvailableInternalSkills(context.repoRoot).map((doc) => ({
      ...doc,
      path: toDisplayPath(cwd, doc.path),
    })),
    available_skills: listAvailableSkills(context.activeProfile, nodes).map((skill) => ({
      ...skill,
      path: toDisplayPath(cwd, skill.path),
    })),
  };
}

export default function knowledgeBaseExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0 || prompt.startsWith('/')) return;

    const context = resolveKnowledgeContext(ctx.cwd);
    const variables = buildTemplateVariables(ctx.cwd, context);
    const rendered = renderSystemPromptTemplate(variables);

    return { systemPrompt: rendered };
  });
}
