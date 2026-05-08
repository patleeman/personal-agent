import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import type { LiveSessionResourceOptions } from '../routes/context.js';

let buildResourceOptions: (() => LiveSessionResourceOptions) | null = null;
let buildExtensionFactories: (() => ExtensionFactory[]) | null = null;

export function setRuntimeAgentHookBuilders(builders: {
  buildLiveSessionResourceOptions: () => LiveSessionResourceOptions;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
}): void {
  buildResourceOptions = builders.buildLiveSessionResourceOptions;
  buildExtensionFactories = builders.buildLiveSessionExtensionFactories;
}

export function buildLiveSessionResourceOptionsForRuntime(): LiveSessionResourceOptions {
  if (!buildResourceOptions) throw new Error('Live session resource option builder is not registered.');
  return buildResourceOptions();
}

export function buildLiveSessionExtensionFactoriesForRuntime(): ExtensionFactory[] {
  if (!buildExtensionFactories) throw new Error('Live session extension factory builder is not registered.');
  return buildExtensionFactories();
}
