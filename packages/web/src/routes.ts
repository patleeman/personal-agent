import { buildNodesHref } from './nodeWorkspaceState';
import {
  getKnowledgeInstructionPath,
  getKnowledgeNoteId,
  getKnowledgeProjectId,
  getKnowledgeSection,
  getKnowledgeSkillName,
} from './knowledgeSelection';

export const WEB_PAGES_PATH = '/pages';
export const WEB_INSTRUCTIONS_PATH = '/instructions';

const LEGACY_KNOWLEDGE_PATH = '/knowledge';
const LEGACY_PROJECTS_PATH = '/projects';
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
  switch (getKnowledgeSection(search)) {
    case 'projects': {
      const projectId = getKnowledgeProjectId(search);
      return projectId ? buildNodesHref('project', projectId) : buildNodesHref(null, null, 'page');
    }
    case 'notes': {
      const noteId = getKnowledgeNoteId(search);
      return noteId ? buildNodesHref('note', noteId) : buildNodesHref(null, null, 'page');
    }
    case 'skills': {
      const skillName = getKnowledgeSkillName(search);
      return skillName ? buildNodesHref('skill', skillName) : buildNodesHref(null, null, 'skill');
    }
    case 'instructions':
      return buildInstructionHref(getKnowledgeInstructionPath(search));
    default:
      return buildNodesHref(null, null, 'page');
  }
}

export function resolveWebRouteRedirect(pathname: string, search = ''): string | null {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === LEGACY_NODES_PATH) {
    return `${WEB_PAGES_PATH}${search}`;
  }

  if (normalizedPath === LEGACY_KNOWLEDGE_PATH) {
    return buildKnowledgeRedirect(search);
  }

  if (normalizedPath === LEGACY_PROJECTS_PATH) {
    return buildNodesHref(null, null, 'page');
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_PROJECTS_PATH)) {
    return buildNodesHref('project', normalizedPath.slice(`${LEGACY_PROJECTS_PATH}/`.length));
  }

  if (normalizedPath === LEGACY_NOTES_PATH || normalizedPath === LEGACY_MEMORIES_PATH) {
    return buildNodesHref(null, null, 'page');
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_NOTES_PATH)) {
    return buildNodesHref('note', normalizedPath.slice(`${LEGACY_NOTES_PATH}/`.length));
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_MEMORIES_PATH)) {
    return buildNodesHref('note', normalizedPath.slice(`${LEGACY_MEMORIES_PATH}/`.length));
  }

  if (normalizedPath === LEGACY_SKILLS_PATH) {
    return buildNodesHref(null, null, 'skill');
  }

  if (isSupportedDetailPath(normalizedPath, LEGACY_SKILLS_PATH)) {
    return buildNodesHref('skill', normalizedPath.slice(`${LEGACY_SKILLS_PATH}/`.length));
  }

  return null;
}
