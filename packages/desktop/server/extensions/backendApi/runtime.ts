import { getPiAgentRuntimeDir } from '@personal-agent/core';

type RuntimeAgentHooksModule = typeof import('../runtimeAgentHooks.js');
const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

export function getRuntimeDir(): string {
  return getPiAgentRuntimeDir();
}

export async function buildLiveSessionExtensionFactoriesForRuntime(
  ...args: Parameters<RuntimeAgentHooksModule['buildLiveSessionExtensionFactoriesForRuntime']>
) {
  const module = await dynamicImport<RuntimeAgentHooksModule>('../runtimeAgentHooks.js');
  return module.buildLiveSessionExtensionFactoriesForRuntime(...args);
}

export async function buildLiveSessionResourceOptionsForRuntime(
  ...args: Parameters<RuntimeAgentHooksModule['buildLiveSessionResourceOptionsForRuntime']>
) {
  const module = await dynamicImport<RuntimeAgentHooksModule>('../runtimeAgentHooks.js');
  return module.buildLiveSessionResourceOptionsForRuntime(...args);
}

export async function buildSessionContextForRuntime(entries: unknown[], leafId: string | null): Promise<{ messages: unknown[] }> {
  if (leafId === null) return { messages: [] };

  const sessionEntries = entries as Array<{ id?: string; parentId?: string; type?: string; message?: unknown }>;
  const byId = new Map(sessionEntries.map((entry) => [entry.id, entry]));
  let leaf = leafId ? byId.get(leafId) : undefined;
  leaf ??= sessionEntries[sessionEntries.length - 1];
  if (!leaf) return { messages: [] };

  const path: typeof sessionEntries = [];
  let current: (typeof sessionEntries)[number] | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return { messages: path.filter((entry) => entry.type === 'message' && entry.message).map((entry) => entry.message) };
}
