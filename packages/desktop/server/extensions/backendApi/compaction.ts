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

const defaultDynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
let dynamicImport = defaultDynamicImport;

export function setExtensionCompactionDynamicImportForTests(importer: typeof dynamicImport): void {
  dynamicImport = importer;
}

export function resetExtensionCompactionDynamicImportForTests(): void {
  dynamicImport = defaultDynamicImport;
}

export async function compactConversation(input: ExtensionCompactInput): Promise<ExtensionCompactResult> {
  const pi = await dynamicImport<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');
  return pi.compact(
    input.preparation as never,
    input.model as never,
    input.apiKey,
    input.headers,
    input.customInstructions,
    input.signal,
  ) as Promise<ExtensionCompactResult>;
}
