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

export interface NoteProfileLayer {
  name: string;
  agentDir: string;
}

export interface NoteProfileContext {
  cwd: string;
  repoRoot: string;
  requestedProfile: string;
  activeProfile: string;
  activeProfileDir: string;
  layers: NoteProfileLayer[];
  activeAgentsFile?: string;
  activeSkillsDir: string;
  activeTasksDir?: string;
  activeNotesDir?: string;
}

interface NoteDefinition {
  name: string;
  description: string;
  path: string;
}

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim();
  return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}

function resolveRepoRoot(): string {
  return resolveRepoRootFromExtension(import.meta.url);
}

function resolveRequestedProfile(): string {
  for (const candidate of [process.env.PERSONAL_AGENT_ACTIVE_PROFILE, process.env.PERSONAL_AGENT_PROFILE]) {
    const sanitized = sanitizeProfileName(candidate);
    if (sanitized) return sanitized;
  }
  return 'shared';
}

function expandHomePath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

function getDefaultStateRoot(): string {
  if (process.env.PERSONAL_AGENT_STATE_ROOT?.trim()) {
    return resolve(expandHomePath(process.env.PERSONAL_AGENT_STATE_ROOT.trim()));
  }
  if (process.env.XDG_STATE_HOME?.trim()) {
    return join(resolve(expandHomePath(process.env.XDG_STATE_HOME.trim())), 'personal-agent');
  }
  return join(homedir(), '.local', 'state', 'personal-agent');
}

function resolveProfilesRoot(): string {
  if (process.env.PERSONAL_AGENT_PROFILES_ROOT?.trim()) {
    return resolve(expandHomePath(process.env.PERSONAL_AGENT_PROFILES_ROOT.trim()));
  }
  return join(getDefaultStateRoot(), 'profiles');
}

function resolveProfileDir(profilesRoot: string, profile: string): string {
  return join(profilesRoot, profile, 'agent');
}

function toDisplayPath(cwd: string, path: string): string {
  const displayed = relative(cwd, path);
  return displayed && !displayed.startsWith('..') ? displayed.replace(/\\/g, '/') : path;
}

function extractFrontmatterBlock(content: string): string | null {
  return content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] ?? null;
}

function parseMarkdownFrontmatter(content: string): Record<string, string> {
  const body = extractFrontmatterBlock(content);
  if (!body) return {};
  const output: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0) continue;
    const key = trimmed.slice(0, sep).trim().toLowerCase();
    const value = trimmed.slice(sep + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && value) output[key] = value;
  }
  return output;
}

function listAvailableNotes(notesDir: string | undefined): NoteDefinition[] {
  if (!notesDir || !existsSync(notesDir)) return [];
  const discovered: NoteDefinition[] = [];
  for (const entry of readdirSync(notesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const noteFile = join(notesDir, entry.name, 'INDEX.md');
    if (!existsSync(noteFile)) continue;
    try {
      const content = readFileSync(noteFile, 'utf-8');
      const frontmatter = parseMarkdownFrontmatter(content);
      if ((frontmatter.kind ?? '').trim().toLowerCase() !== 'note') continue;
      const name = (frontmatter.id ?? basename(entry.name)).trim();
      const description = (frontmatter.summary ?? frontmatter.description ?? '').trim();
      if (name && description) discovered.push({ name, description, path: noteFile });
    } catch {
      // Ignore malformed note nodes.
    }
  }
  return discovered.sort((l, r) => l.name.localeCompare(r.name));
}

export function resolveNoteProfileContext(cwd: string): NoteProfileContext {
  const repoRoot = resolveRepoRoot();
  const profilesRoot = resolveProfilesRoot();
  const requestedProfile = resolveRequestedProfile();
  const requestedProfileDir = resolveProfileDir(profilesRoot, requestedProfile);
  const sharedProfileDir = resolveProfileDir(profilesRoot, 'shared');
  const activeProfile = requestedProfile === 'shared' || existsSync(requestedProfileDir)
    ? requestedProfile
    : 'shared';
  const activeProfileDir = activeProfile === 'shared' ? sharedProfileDir : requestedProfileDir;
  const layers: NoteProfileLayer[] = [{ name: 'shared', agentDir: sharedProfileDir }];
  if (activeProfile !== 'shared') layers.push({ name: activeProfile, agentDir: activeProfileDir });

  return {
    cwd,
    repoRoot,
    requestedProfile,
    activeProfile,
    activeProfileDir,
    layers,
    activeAgentsFile: activeProfile === 'shared' ? undefined : join(activeProfileDir, 'AGENTS.md'),
    activeSkillsDir: join(activeProfileDir, 'skills'),
    activeTasksDir: activeProfile === 'shared' ? undefined : join(activeProfileDir, 'tasks'),
    activeNotesDir: join(dirname(profilesRoot), 'notes'),
  };
}

function buildNoteTemplateVariables(cwd: string, context: ReturnType<typeof resolveNoteProfileContext>) {
  const notesDir = context.activeNotesDir;
  const notesAvailable = !!(notesDir && existsSync(notesDir));

  return {
    active_profile: context.activeProfile,
    active_profile_dir: toDisplayPath(cwd, context.activeProfileDir),
    repo_root: toDisplayPath(cwd, context.repoRoot),
    requested_profile: context.requestedProfile,
    agents_edit_target: context.activeAgentsFile
      ? toDisplayPath(cwd, context.activeAgentsFile)
      : 'none (shared profile does not use AGENTS.md)',
    skills_dir: toDisplayPath(cwd, context.activeSkillsDir),
    tasks_dir: context.activeTasksDir ? toDisplayPath(cwd, context.activeTasksDir) : 'none (shared profile does not use profile task dir)',
    notes_available: notesAvailable,
    notes_dir: notesDir ? toDisplayPath(cwd, notesDir) : 'unavailable',
    docs_dir: toDisplayPath(cwd, join(context.repoRoot, 'docs')),
    docs_index: toDisplayPath(cwd, join(context.repoRoot, 'docs', 'README.md')),
    available_notes: listAvailableNotes(notesDir),
  };
}

export default function notePolicyExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', async (event, ctx) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0 || prompt.startsWith('/')) return;

    const context = resolveNoteProfileContext(ctx.cwd);
    const variables = buildNoteTemplateVariables(ctx.cwd, context);
    const template = requirePromptCatalogEntryFromExtension(import.meta.url, 'system.md');
    const rendered = renderPromptCatalogTemplate(template, variables, import.meta.url);

    return { systemPrompt: rendered };
  });
}
