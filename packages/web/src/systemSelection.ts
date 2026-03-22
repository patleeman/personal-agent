export const SYSTEM_COMPONENT_IDS = ['web-ui', 'daemon', 'gateway', 'sync'] as const;

export type SystemComponentId = (typeof SYSTEM_COMPONENT_IDS)[number];

const SYSTEM_COMPONENT_PARAM = 'component';
const SYSTEM_RUN_PARAM = 'run';
const SYSTEM_COMPONENT_SET = new Set<string>(SYSTEM_COMPONENT_IDS);

const SYSTEM_COMPONENT_LABELS: Record<SystemComponentId, string> = {
  'web-ui': 'Web UI',
  daemon: 'Daemon',
  gateway: 'Gateway',
  sync: 'Sync',
};

export function normalizeSystemComponent(value: string | null | undefined): SystemComponentId | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return SYSTEM_COMPONENT_SET.has(normalized) ? normalized as SystemComponentId : null;
}

export function readSystemComponentFromSearch(search: string): SystemComponentId | null {
  const value = new URLSearchParams(search).get(SYSTEM_COMPONENT_PARAM);
  return normalizeSystemComponent(value);
}

export function getSystemComponentFromSearch(search: string, fallback: SystemComponentId = 'web-ui'): SystemComponentId {
  return readSystemComponentFromSearch(search) ?? fallback;
}

export function getSystemRunIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SYSTEM_RUN_PARAM);
  return value?.trim() || null;
}

export function buildSystemSearch(currentSearch: string, component: SystemComponentId | null): string {
  const params = new URLSearchParams(currentSearch);

  if (component) {
    params.set(SYSTEM_COMPONENT_PARAM, component);
  } else {
    params.delete(SYSTEM_COMPONENT_PARAM);
  }

  params.delete(SYSTEM_RUN_PARAM);

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function buildSystemRunSearch(currentSearch: string, runId: string | null, component?: SystemComponentId | null): string {
  const params = new URLSearchParams(currentSearch);

  if (component !== undefined) {
    if (component) {
      params.set(SYSTEM_COMPONENT_PARAM, component);
    } else {
      params.delete(SYSTEM_COMPONENT_PARAM);
    }
  }

  if (runId) {
    params.set(SYSTEM_RUN_PARAM, runId);
  } else {
    params.delete(SYSTEM_RUN_PARAM);
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function getSystemComponentLabel(component: SystemComponentId): string {
  return SYSTEM_COMPONENT_LABELS[component];
}
