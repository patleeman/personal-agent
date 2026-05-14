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
