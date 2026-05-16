import { type ComponentType, lazy } from 'react';

const LAZY_ROUTE_RECOVERY_PREFIX = '__pa_lazy_route_recovery__:';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error ?? '');
}

export function isRecoverableLazyRouteError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('failed to load module script')
  );
}

function getRecoveryStorageKey(routeId: string): string {
  return `${LAZY_ROUTE_RECOVERY_PREFIX}${routeId}`;
}

function clearLazyRouteRecovery(routeId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(getRecoveryStorageKey(routeId));
  } catch {
    // Ignore storage failures.
  }
}

export function attemptLazyRouteRecovery(routeId: string): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const storageKey = getRecoveryStorageKey(routeId);

  try {
    if (window.sessionStorage.getItem(storageKey) === '1') {
      window.sessionStorage.removeItem(storageKey);
      return false;
    }

    window.sessionStorage.setItem(storageKey, '1');
  } catch {
    // Best effort only. If storage is unavailable, still try one reload.
  }

  window.location.reload();
  return true;
}

export function lazyWithRecovery<T extends ComponentType<unknown>>(recoveryId: string, loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await loader();
      clearLazyRouteRecovery(recoveryId);
      return module;
    } catch (error) {
      if (isRecoverableLazyRouteError(error) && attemptLazyRouteRecovery(recoveryId)) {
        await new Promise<never>(() => {});
      }

      throw error;
    }
  });
}

export function lazyRouteWithRecovery<T extends ComponentType<unknown>>(routeId: string, loader: () => Promise<{ default: T }>) {
  return lazyWithRecovery(routeId, loader);
}
