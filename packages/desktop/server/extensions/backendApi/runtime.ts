import { getPiAgentRuntimeDir } from '@personal-agent/core';

type RuntimeAgentHooksModule = typeof import('../runtimeAgentHooks.js');
type PiCodingAgentModule = typeof import('@earendil-works/pi-coding-agent');

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
  const module = await dynamicImport<PiCodingAgentModule>('@earendil-works/pi-coding-agent');
  return module.buildSessionContext(entries as never, leafId) as { messages: unknown[] };
}
