import type { ExtensionBackendContext } from '../index';

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

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/compaction must be resolved by the Personal Agent host runtime.');
}

export async function compactConversation(_input: ExtensionCompactInput, _ctx: ExtensionBackendContext): Promise<ExtensionCompactResult> {
  hostResolved();
}
