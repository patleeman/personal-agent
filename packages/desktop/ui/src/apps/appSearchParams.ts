/**
 * Search param helpers for skill apps (matching artifact/checkpoint/run pattern).
 */

export function getAppNameFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.get('app');
}

export function setAppNameInSearch(search: string, appName: string | null): string {
  const next = new URLSearchParams(search);
  if (appName) {
    next.set('app', appName);
  } else {
    next.delete('app');
  }

  return next.toString();
}
