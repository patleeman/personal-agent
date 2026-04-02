import type { NodeLinkKind } from '../types';
import { buildNodesSearch, type NodeBrowserFilter } from '../nodeWorkspaceState';

export const COMPANION_APP_PATH = '/app';
export const COMPANION_INBOX_PATH = '/app/inbox';
export const COMPANION_CONVERSATIONS_PATH = '/app/conversations';
export const COMPANION_TASKS_PATH = '/app/tasks';
export const COMPANION_SYSTEM_PATH = '/app/system';
export const COMPANION_PAGES_PATH = '/app/pages';
export const COMPANION_QUICK_NOTE_PATH = '/app/capture';
const LEGACY_COMPANION_KNOWLEDGE_PATH = '/app/knowledge';
const LEGACY_COMPANION_MEMORIES_PATH = '/app/memories';
const LEGACY_COMPANION_NOTES_PATH = '/app/notes';
const LEGACY_COMPANION_PROJECTS_PATH = '/app/projects';
const LEGACY_COMPANION_SKILLS_PATH = '/app/skills';
const LEGACY_COMPANION_MEMORIES_DETAIL_PREFIX = '/app/memories/';
const LEGACY_COMPANION_NOTES_DETAIL_PREFIX = '/app/notes/';
const LEGACY_COMPANION_PROJECTS_DETAIL_PREFIX = '/app/projects/';
const LEGACY_COMPANION_SKILLS_DETAIL_PREFIX = '/app/skills/';

const COMPANION_TOP_LEVEL_PATHS = new Set([
  COMPANION_APP_PATH,
  COMPANION_INBOX_PATH,
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_TASKS_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_PAGES_PATH,
  COMPANION_QUICK_NOTE_PATH,
]);

function buildCompanionDetailPath(basePath: string, id: string): string {
  return `${basePath}/${encodeURIComponent(id)}`;
}

function buildCompanionPageSearch(kind: NodeLinkKind | null, id?: string | null, filter?: NodeBrowserFilter | null): string {
  return buildNodesSearch('', {
    ...(filter ? { filter } : {}),
    kind,
    nodeId: id ?? null,
  });
}

export function buildCompanionConversationPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_CONVERSATIONS_PATH, id);
}

export function buildCompanionTaskPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_TASKS_PATH, id);
}

export function buildCompanionPagesFilterPath(filter: NodeBrowserFilter): string {
  return `${COMPANION_PAGES_PATH}${buildCompanionPageSearch(null, null, filter)}`;
}

export function buildCompanionPagePath(kind: NodeLinkKind, id: string): string {
  return `${COMPANION_PAGES_PATH}${buildCompanionPageSearch(kind, id)}`;
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '');
}

function buildLegacyCompanionPagePath(kind: NodeLinkKind, routeId: string): string {
  return buildCompanionPagePath(kind, decodeURIComponent(routeId));
}

function isSupportedDetailPath(normalizedPath: string, basePath: string): boolean {
  const detailPrefix = `${basePath}/`;
  if (!normalizedPath.startsWith(detailPrefix)) {
    return false;
  }

  const routeId = normalizedPath.slice(detailPrefix.length);
  return routeId.length > 0 && !routeId.includes('/');
}

export function resolveCompanionRouteRedirect(pathname: string): string | null {
  if (pathname !== COMPANION_APP_PATH && !pathname.startsWith(`${COMPANION_APP_PATH}/`)) {
    return null;
  }

  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === COMPANION_APP_PATH) {
    return pathname === COMPANION_APP_PATH ? null : COMPANION_INBOX_PATH;
  }

  if (normalizedPath === LEGACY_COMPANION_KNOWLEDGE_PATH) {
    return COMPANION_PAGES_PATH;
  }

  if (
    normalizedPath === LEGACY_COMPANION_MEMORIES_PATH
    || normalizedPath === LEGACY_COMPANION_NOTES_PATH
    || normalizedPath === LEGACY_COMPANION_PROJECTS_PATH
    || normalizedPath === LEGACY_COMPANION_SKILLS_PATH
  ) {
    return COMPANION_PAGES_PATH;
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_COMPANION_MEMORIES_PATH)) {
    return buildLegacyCompanionPagePath('note', normalizedPath.slice(LEGACY_COMPANION_MEMORIES_DETAIL_PREFIX.length));
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_COMPANION_NOTES_PATH)) {
    return buildLegacyCompanionPagePath('note', normalizedPath.slice(LEGACY_COMPANION_NOTES_DETAIL_PREFIX.length));
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_COMPANION_PROJECTS_PATH)) {
    return buildLegacyCompanionPagePath('project', normalizedPath.slice(LEGACY_COMPANION_PROJECTS_DETAIL_PREFIX.length));
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_COMPANION_SKILLS_PATH)) {
    return buildLegacyCompanionPagePath('skill', normalizedPath.slice(LEGACY_COMPANION_SKILLS_DETAIL_PREFIX.length));
  }

  if (COMPANION_TOP_LEVEL_PATHS.has(normalizedPath)) {
    return pathname === normalizedPath ? null : normalizedPath;
  }

  if (
    isSupportedDetailPath(normalizedPath, COMPANION_CONVERSATIONS_PATH)
    || isSupportedDetailPath(normalizedPath, COMPANION_TASKS_PATH)
  ) {
    return pathname === normalizedPath ? null : normalizedPath;
  }

  return COMPANION_INBOX_PATH;
}
