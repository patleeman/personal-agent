export const COMPANION_APP_PATH = '/app';
export const COMPANION_INBOX_PATH = '/app/inbox';
export const COMPANION_CONVERSATIONS_PATH = '/app/conversations';
export const COMPANION_TASKS_PATH = '/app/tasks';
export const COMPANION_SYSTEM_PATH = '/app/system';
export const COMPANION_PROJECTS_PATH = '/app/projects';
export const COMPANION_MEMORIES_PATH = '/app/memories';
export const COMPANION_SKILLS_PATH = '/app/skills';

const COMPANION_TOP_LEVEL_PATHS = new Set([
  COMPANION_APP_PATH,
  COMPANION_INBOX_PATH,
  COMPANION_CONVERSATIONS_PATH,
  COMPANION_TASKS_PATH,
  COMPANION_SYSTEM_PATH,
  COMPANION_PROJECTS_PATH,
  COMPANION_MEMORIES_PATH,
  COMPANION_SKILLS_PATH,
]);

function buildCompanionDetailPath(basePath: string, id: string): string {
  return `${basePath}/${encodeURIComponent(id)}`;
}

export function buildCompanionConversationPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_CONVERSATIONS_PATH, id);
}

export function buildCompanionTaskPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_TASKS_PATH, id);
}

export function buildCompanionProjectPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_PROJECTS_PATH, id);
}

export function buildCompanionMemoryPath(id: string): string {
  return buildCompanionDetailPath(COMPANION_MEMORIES_PATH, id);
}

export function buildCompanionSkillPath(name: string): string {
  return buildCompanionDetailPath(COMPANION_SKILLS_PATH, name);
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '');
}

function isSupportedCompanionDetailPath(normalizedPath: string, basePath: string): boolean {
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

  if (COMPANION_TOP_LEVEL_PATHS.has(normalizedPath)) {
    return pathname === normalizedPath ? null : normalizedPath;
  }

  if (
    isSupportedCompanionDetailPath(normalizedPath, COMPANION_CONVERSATIONS_PATH)
    || isSupportedCompanionDetailPath(normalizedPath, COMPANION_TASKS_PATH)
    || isSupportedCompanionDetailPath(normalizedPath, COMPANION_PROJECTS_PATH)
    || isSupportedCompanionDetailPath(normalizedPath, COMPANION_MEMORIES_PATH)
    || isSupportedCompanionDetailPath(normalizedPath, COMPANION_SKILLS_PATH)
  ) {
    return pathname === normalizedPath ? null : normalizedPath;
  }

  return COMPANION_INBOX_PATH;
}
