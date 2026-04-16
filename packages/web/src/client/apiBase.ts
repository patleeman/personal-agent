export const DESKTOP_API_PREFIX = '/api';

export function resolveApiPrefix(_pathname: string | null | undefined): string {
  return DESKTOP_API_PREFIX;
}

export function buildApiPath(path: string, pathname?: string | null | undefined): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const currentPathname = pathname ?? (typeof window === 'undefined' ? undefined : window.location.pathname);
  return `${resolveApiPrefix(currentPathname)}${normalizedPath}`;
}
