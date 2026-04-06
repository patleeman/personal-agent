import {
  getKnowledgeInstructionPath,
  getKnowledgeSection,
} from './knowledgeSelection';

export const WEB_INSTRUCTIONS_PATH = '/instructions';

const LEGACY_KNOWLEDGE_PATH = '/knowledge';
const LEGACY_NOTES_PATH = '/notes';
const LEGACY_MEMORIES_PATH = '/memories';
const LEGACY_SKILLS_PATH = '/skills';
const LEGACY_NODES_PATH = '/nodes';

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '');
}

function isSupportedDetailPath(normalizedPath: string, basePath: string): boolean {
  const detailPrefix = `${basePath}/`;
  if (!normalizedPath.startsWith(detailPrefix)) {
    return false;
  }

  const routeId = normalizedPath.slice(detailPrefix.length);
  return routeId.length > 0 && !routeId.includes('/');
}

function buildInstructionHref(path: string | null): string {
  if (!path) {
    return WEB_INSTRUCTIONS_PATH;
  }
  return `${WEB_INSTRUCTIONS_PATH}?instruction=${encodeURIComponent(path)}`;
}

function buildKnowledgeRedirect(search: string): string {
  if (getKnowledgeSection(search) === 'instructions') {
    return buildInstructionHref(getKnowledgeInstructionPath(search));
  }

  return '/workspace/files';
}

export function resolveWebRouteRedirect(pathname: string, search = ''): string | null {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === LEGACY_NODES_PATH) {
    return '/workspace/files';
  }

  if (normalizedPath === LEGACY_KNOWLEDGE_PATH) {
    return buildKnowledgeRedirect(search);
  }

  if (normalizedPath === LEGACY_NOTES_PATH || normalizedPath === LEGACY_MEMORIES_PATH) {
    return '/workspace/files';
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_NOTES_PATH)) {
    return '/workspace/files';
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_MEMORIES_PATH)) {
    return '/workspace/files';
  }

  if (normalizedPath === LEGACY_SKILLS_PATH) {
    return '/workspace/files';
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_SKILLS_PATH)) {
    return '/workspace/files';
  }

  return null;
}
