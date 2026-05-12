import type { DaemonConfig } from '../../config.js';
import type { CompanionRuntime, CompanionRuntimeProvider } from './types.js';

let companionRuntimeProvider: CompanionRuntimeProvider | undefined;

export function setCompanionRuntimeProvider(provider: CompanionRuntimeProvider | undefined): void {
  companionRuntimeProvider = provider;
}

export function getCompanionRuntimeProvider(): CompanionRuntimeProvider | undefined {
  return companionRuntimeProvider;
}

export async function resolveCompanionRuntime(config: DaemonConfig): Promise<CompanionRuntime | null> {
  if (!companionRuntimeProvider) {
    return null;
  }

  return companionRuntimeProvider(config);
}
