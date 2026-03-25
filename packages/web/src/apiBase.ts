import { isCompanionPath } from './companion/pwa';

export const DESKTOP_API_PREFIX = '/api';
export const COMPANION_API_PREFIX = '/app/api';

export function resolveApiPrefix(pathname: string | null | undefined): string {
  return isCompanionPath(pathname) ? COMPANION_API_PREFIX : DESKTOP_API_PREFIX;
}

export function buildApiPath(path: string, pathname?: string | null | undefined): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const currentPathname = pathname ?? (typeof window === 'undefined' ? undefined : window.location.pathname);
  return `${resolveApiPrefix(currentPathname)}${normalizedPath}`;
}
