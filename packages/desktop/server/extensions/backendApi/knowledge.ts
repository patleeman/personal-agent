import { callServerModuleExport } from './serverModuleResolver.js';

async function callCoreExport<T>(name: string, ...args: unknown[]): Promise<T> {
  return callServerModuleExport<T>('@personal-agent/core', name, ...args);
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

async function invalidateKnowledgeBase(): Promise<void> {
  try {
    const appEvents = await dynamicImport('../../shared/appEvents.js');
    const invalidate = appEvents.invalidateAppTopics;
    if (typeof invalidate === 'function') invalidate('knowledgeBase');
  } catch {
    // Invalidation is best-effort for extension backend bundles.
  }
}

export async function readKnowledgeState() {
  return callCoreExport('readKnowledgeBaseState');
}

export async function updateKnowledgeState(input: { repoUrl?: string | null; branch?: string | null }) {
  const nextState = await callCoreExport('updateKnowledgeBase', input);
  await invalidateKnowledgeBase();
  return nextState;
}

export async function syncKnowledgeState() {
  const nextState = await callCoreExport('syncKnowledgeBaseNow');
  await invalidateKnowledgeBase();
  return nextState;
}
