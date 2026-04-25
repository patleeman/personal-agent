import type { HostApiDispatchResult } from './hosts/types.js';
import { parseApiDispatchResult, readApiDispatchError } from './hosts/api-dispatch.js';

export interface DesktopUrlClipperHost {
  ensureActiveHostRunning(): Promise<void>;
  getActiveHostController(): {
    dispatchApiRequest(input: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;
      body?: unknown;
      headers?: Record<string, string>;
    }): Promise<HostApiDispatchResult>;
  };
}

export interface DesktopUrlClipImportResult {
  title: string;
  note?: {
    id?: string;
  };
}

export function normalizeClipboardUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error('Clipboard is empty. Copy a URL first.');
  }

  const firstLine = value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  let parsed: URL;
  try {
    parsed = new URL(firstLine);
  } catch {
    throw new Error('Clipboard does not contain a valid URL. Copy a URL first.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be clipped.');
  }

  return parsed.toString();
}

export async function importClipboardUrlToKnowledge(input: {
  host: DesktopUrlClipperHost;
  clipboardText: string;
  createdAt?: string;
}): Promise<DesktopUrlClipImportResult> {
  const url = normalizeClipboardUrl(input.clipboardText);
  await input.host.ensureActiveHostRunning();
  const response = await input.host.getActiveHostController().dispatchApiRequest({
    method: 'POST',
    path: '/api/vault/share-import',
    body: {
      kind: 'url',
      url,
      directoryId: 'Inbox',
      sourceApp: 'Personal Agent Desktop',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(readApiDispatchError(response));
  }

  return parseApiDispatchResult<DesktopUrlClipImportResult>(response);
}
