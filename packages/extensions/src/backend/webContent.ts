import type { ExtensionBackendContext } from '../index';

export interface ReadableHtmlResult {
  markdown: string;
  title?: string;
}

export interface SearchHtmlResult {
  title: string;
  url: string;
  snippet: string;
}

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/webContent must be resolved by the Personal Agent host runtime.');
}

export async function extractReadableHtml(
  _input: { html: string; url: string },
  _ctx?: ExtensionBackendContext,
): Promise<ReadableHtmlResult> {
  hostResolved();
}

export async function parseDuckDuckGoHtml(
  _input: { html: string; maxResults: number },
  _ctx?: ExtensionBackendContext,
): Promise<SearchHtmlResult[]> {
  hostResolved();
}
