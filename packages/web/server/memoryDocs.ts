/**
 * Memory docs service
 *
 * Shared helpers for memory browsing and note operations.
 * Extracted from index.ts so route modules can use them.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { getProfilesRoot } from '@personal-agent/core';

// ── Profile getter ────────────────────────────────────────────────────────────

let _getCurrentProfile: () => string = () => {
  throw new Error('getCurrentProfile not initialized for memory docs');
};

export function setMemoryDocsProfileGetter(getCurrentProfile: () => string): void {
  _getCurrentProfile = getCurrentProfile;
}

export function getMemoryDocsCurrentProfile(): string {
  return _getCurrentProfile();
}

// ── Memory path utilities ───────────────────────────────────────────────────────

export function normalizeMemoryPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return normalize(value.trim());
  } catch {
    return '';
  }
}

export function isEditableMemoryFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = normalizeMemoryPath(filePath);
  if (!normalized) return false;
  const profilesRoot = getProfilesRoot();
  const memoryDir = join(profilesRoot, _getCurrentProfile(), 'memory');
  return normalized.startsWith(memoryDir + '/');
}

// ── Memory docs ───────────────────────────────────────────────────────────────

interface MemoryDocFrontmatter {
  id?: string;
  title?: string;
  summary?: string;
  description?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface MemoryDocItem {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  path: string;
  updated?: string;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface MemoryDocDetail extends MemoryDocItem {
  body?: string;
}

function _ensureMemoryDocsDir(): string {
  const profilesRoot = getProfilesRoot();
  const memoryDir = join(profilesRoot, _getCurrentProfile(), 'memory');
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  return memoryDir;
}

export function ensureMemoryDocsDir(): string {
  return _ensureMemoryDocsDir();
}

function _loadMemoryDocMetadata(filePath: string): MemoryDocItem | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const normalized = raw.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return null;
    const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) return null;
    const parsed = document.toJS() as MemoryDocFrontmatter;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: parsed.id ?? '',
      title: parsed.title ?? '',
      summary: parsed.summary?.toString().trim(),
      description: parsed.description?.toString().trim(),
      path: filePath,
      updated: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function _listMemoryDocsFromDir(dir: string): MemoryDocItem[] {
  const docs: MemoryDocItem[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const doc = _loadMemoryDocMetadata(join(dir, entry.name));
      if (doc) docs.push(doc);
    }
  } catch {
    // ignore
  }
  docs.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
  return docs;
}

let _memoryDocsCache: MemoryDocItem[] | null = null;
let _memoryDocsCacheAt = 0;
const MEMORY_DOCS_CACHE_TTL_MS = 30_000;

export function clearMemoryBrowserCaches(): void {
  _memoryDocsCache = null;
}

export function warmMemoryBrowserCaches(_profile = _getCurrentProfile()): void {
  void listMemoryDocs();
  void listSkillsForProfile(_profile);
}

export interface RecentReadUsageEntry {
  recentSessionCount: number;
  lastUsedAt: string | null;
  usedInLastSession: boolean;
}

export function buildRecentReadUsage(_paths: string[]): Map<string, RecentReadUsageEntry> {
  return new Map();
}

export function listMemoryDocs(options: { includeSearchText?: boolean } = {}): MemoryDocItem[] {
  const now = Date.now();
  if (!_memoryDocsCache || now - _memoryDocsCacheAt > MEMORY_DOCS_CACHE_TTL_MS || options.includeSearchText) {
    const profilesRoot = getProfilesRoot();
    const memoryDir = join(profilesRoot, _getCurrentProfile(), 'memory');
    _memoryDocsCache = existsSync(memoryDir) ? _listMemoryDocsFromDir(memoryDir) : [];
    _memoryDocsCacheAt = now;
  }
  return _memoryDocsCache!.map((doc) => ({ ...doc }));
}

export function findMemoryDocById(
  memoryId: string,
  options: { includeSearchText?: boolean } = {},
): MemoryDocItem | null {
  return listMemoryDocs(options).find((doc) => doc.id === memoryId) ?? null;
}

// ── Skills ────────────────────────────────────────────────────────────────────

function _inferSkillSource(filePath: string): string {
  const profilesRoot = getProfilesRoot();
  const profile = _getCurrentProfile();
  if (filePath.startsWith(join(profilesRoot, profile, 'skills/'))) return 'profile';
  if (filePath.includes('/skills/')) return 'global';
  return 'project';
}

function _listSkillFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) return [];
  const files: string[] = [];
  try {
    for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        files.push(..._listSkillFiles(join(skillDir, entry.name)));
      } else if (entry.name.endsWith('.md')) {
        files.push(join(skillDir, entry.name));
      }
    }
  } catch {
    // ignore
  }
  return files;
}

export interface SkillItem {
  name: string;
  source: string;
  description: string;
  path: string;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export function listSkillsForProfile(profile = _getCurrentProfile()): SkillItem[] {
  const profilesRoot = getProfilesRoot();
  const profileDir = join(profilesRoot, profile);
  const skillDirs = [join(profileDir, 'skills'), join(profileDir, '.skills')];
  const skills: SkillItem[] = [];
  for (const skillDir of skillDirs) {
    for (const filePath of _listSkillFiles(skillDir)) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        let title = filePath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/, '') ?? '';
        let description = '';
        if (match) {
          const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
          if (document.errors.length === 0) {
            const parsed = document.toJS() as Record<string, unknown>;
            if (typeof parsed.title === 'string' && parsed.title.trim()) {
              title = parsed.title.trim();
            }
            if (typeof parsed.description === 'string') description = parsed.description.trim();
          }
        }
        const name = title.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
        skills.push({ name, source: _inferSkillSource(filePath), description, path: filePath });
      } catch {
        // ignore
      }
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function readSkillDetailForProfile(skillName: string, profile = _getCurrentProfile()): SkillItem | null {
  return listSkillsForProfile(profile).find((s) => s.name === skillName) ?? null;
}

// ── Notes ────────────────────────────────────────────────────────────────────

const MAX_CREATED_NOTE_ID_LENGTH = 52;

export function normalizeCreatedNoteTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCreatedNoteSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCreatedNoteDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeNoteBody(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim();
}

export function extractNoteSummaryFromBody(content: string): string {
  for (const paragraph of content.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const text = paragraph.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && !text.startsWith('#')) return text;
  }
  return '';
}

function _parseNoteFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: normalized.trim() };
  const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? 'Invalid note frontmatter.');
  const parsed = document.toJS() as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Note frontmatter must be an object.');
  }
  return { frontmatter: parsed as Record<string, unknown>, body: (match[2] ?? '').replace(/^\n+/, '') };
}

function _stringifyNoteMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const text = stringifyYaml(frontmatter, { lineWidth: 0, indent: 2, minContentWidth: 0 }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${text}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

export function buildStructuredNoteMarkdown(rawContent: string, input: {
  noteId: string;
  title: string;
  summary?: string;
  description?: string;
  descriptionProvided?: boolean;
  body: string;
}): string {
  const title = normalizeCreatedNoteTitle(input.title);
  if (title.length === 0) throw new Error('title required');
  const editableBody = normalizeNoteBody(input.body);
  const summary = normalizeCreatedNoteSummary(input.summary)
    || extractNoteSummaryFromBody(editableBody)
    || `Personal note about ${title}.`;
  const parsed = _parseNoteFrontmatter(rawContent);
  const description = input.descriptionProvided
    ? normalizeCreatedNoteDescription(input.description)
    : normalizeCreatedNoteDescription(parsed.frontmatter.description as string);
  const frontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    id: (typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim().length > 0)
      ? parsed.frontmatter.id.trim()
      : input.noteId,
    kind: 'note',
    title,
    summary,
    ...(description ? { description } : {}),
    status: (typeof parsed.frontmatter.status === 'string' && parsed.frontmatter.status.trim().length > 0)
      ? parsed.frontmatter.status.trim()
      : 'active',
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  delete (frontmatter as Record<string, unknown>).links;
  delete (frontmatter as Record<string, unknown>).parent;
  delete (frontmatter as Record<string, unknown>).related;
  delete (frontmatter as Record<string, unknown>).tags;
  const markdownBody = editableBody.length > 0 ? `# ${title}\n\n${editableBody}` : `# ${title}`;
  return _stringifyNoteMarkdown(frontmatter, markdownBody);
}

function _slugifyNoteId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, MAX_CREATED_NOTE_ID_LENGTH).replace(/-+$/g, '') || 'note';
}

export function generateCreatedNoteId(title: string): string {
  const existingIds = new Set(listMemoryDocs().map((d) => d.id));
  const base = _slugifyNoteId(title);
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < Number.MAX_SAFE_INTEGER; i++) {
    const suffix = `-${i}`;
    const candidate = base.slice(0, MAX_CREATED_NOTE_ID_LENGTH - suffix.length).replace(/-+$/g, '') + suffix;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface CreatedMemoryDoc {
  id: string;
  filePath?: string;
  title: string;
  summary?: string;
  description?: string;
  status: string;
}

export function createMemoryDoc(input: CreatedMemoryDoc): CreatedMemoryDoc {
  _ensureMemoryDocsDir();
  const profilesRoot = getProfilesRoot();
  const filePath = join(profilesRoot, _getCurrentProfile(), 'memory', `${input.id}.md`);
  writeFileSync(filePath, buildStructuredNoteMarkdown('', {
    noteId: input.id,
    title: input.title,
    summary: input.summary,
    description: input.description,
    descriptionProvided: !!input.description,
    body: '',
  }), 'utf-8');
  return { ...input, filePath };
}

export function readNoteDetail(memoryId: string): MemoryDocDetail {
  const item = findMemoryDocById(memoryId);
  if (!item) throw new Error('Note not found.');
  try {
    const body = readFileSync(item.path, 'utf-8');
    return { ...item, body };
  } catch {
    return { ...item };
  }
}
