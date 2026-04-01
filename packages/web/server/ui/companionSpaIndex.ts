const COMPANION_ROOT_FALLBACK_PREFIXES = [
  '/conversations',
  '/capture',
  '/projects',
  '/notes',
  '/memories',
  '/skills',
] as const;

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') {
    return '/';
  }

  return pathname.replace(/\/+$/, '');
}

export function shouldServeCompanionIndex(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === '/' || normalizedPath === '/app' || normalizedPath.startsWith('/app/')) {
    return true;
  }

  return COMPANION_ROOT_FALLBACK_PREFIXES.some((prefix) => (
    normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`)
  ));
}
