import type { AgentSession } from '@earendil-works/pi-coding-agent';

export interface LiveSessionRegistryMaintenanceHost {
  session: AgentSession;
}

export function reloadAllLiveSessionAuth(entries: Iterable<LiveSessionRegistryMaintenanceHost>): number {
  let reloadedCount = 0;

  for (const entry of entries) {
    const authStorage = entry.session.modelRegistry?.authStorage;
    if (!authStorage || typeof authStorage.reload !== 'function') {
      continue;
    }

    authStorage.reload();
    reloadedCount += 1;
  }

  return reloadedCount;
}

export function refreshAllLiveSessionModelRegistries(entries: Iterable<LiveSessionRegistryMaintenanceHost>): number {
  let refreshedCount = 0;

  for (const entry of entries) {
    const modelRegistry = entry.session.modelRegistry;
    if (!modelRegistry || typeof modelRegistry.refresh !== 'function') {
      continue;
    }

    modelRegistry.refresh();
    refreshedCount += 1;
  }

  return refreshedCount;
}
