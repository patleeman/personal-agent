export interface ExtensionCompactInput {
  preparation: unknown;
  model: unknown;
  apiKey: string;
  headers?: Record<string, string>;
  customInstructions?: string;
  signal?: AbortSignal;
}

export interface ExtensionCompactResult {
  summary: string;
  firstKeptEntryId?: string | null;
  tokensBefore?: number;
  details?: unknown;
}

import { importServerModule } from './serverModuleResolver.js';

const defaultDynamicImport = importServerModule;
let dynamicImport = defaultDynamicImport;
const PI_CODING_AGENT_PACKAGE = '@earendil-works/pi-coding-agent';

export function setExtensionCompactionDynamicImportForTests(importer: typeof dynamicImport): void {
  dynamicImport = importer;
}

export function resetExtensionCompactionDynamicImportForTests(): void {
  dynamicImport = defaultDynamicImport;
}

export async function compactConversation(input: ExtensionCompactInput): Promise<ExtensionCompactResult> {
  const pi = await dynamicImport<typeof import('@earendil-works/pi-coding-agent')>(PI_CODING_AGENT_PACKAGE);
  return pi.compact(
    input.preparation as never,
    input.model as never,
    input.apiKey,
    input.headers,
    input.customInstructions,
    input.signal,
  ) as Promise<ExtensionCompactResult>;
}
