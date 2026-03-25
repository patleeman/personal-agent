export const COMPANION_APP_PATH = '/app';
export const COMPANION_CONVERSATIONS_PATH = '/app/conversations';

export function buildCompanionConversationPath(id: string): string {
  return `${COMPANION_CONVERSATIONS_PATH}/${encodeURIComponent(id)}`;
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '');
}

export function resolveCompanionRouteRedirect(pathname: string): string | null {
  if (pathname !== COMPANION_APP_PATH && !pathname.startsWith(`${COMPANION_APP_PATH}/`)) {
    return null;
  }

  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === COMPANION_APP_PATH) {
    return pathname === COMPANION_APP_PATH ? null : COMPANION_CONVERSATIONS_PATH;
  }

  if (normalizedPath === COMPANION_CONVERSATIONS_PATH) {
    return pathname === COMPANION_CONVERSATIONS_PATH ? null : COMPANION_CONVERSATIONS_PATH;
  }

  const detailPrefix = `${COMPANION_CONVERSATIONS_PATH}/`;
  if (normalizedPath.startsWith(detailPrefix)) {
    const routeId = normalizedPath.slice(detailPrefix.length);
    if (routeId.length > 0 && !routeId.includes('/')) {
      return pathname === normalizedPath ? null : normalizedPath;
    }
  }

  return COMPANION_CONVERSATIONS_PATH;
}
