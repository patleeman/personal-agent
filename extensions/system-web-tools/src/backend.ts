import type { ExtensionBackendContext } from '@personal-agent/extensions';
import { extractReadableHtml, parseDuckDuckGoHtml } from '@personal-agent/extensions/backend/webContent';

const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function truncateHead(content: string, options: { maxLines: number; maxBytes: number }) {
  const lines = content.split(/\r?\n/);
  let output = lines.slice(0, options.maxLines).join('\n');
  let outputBytes = Buffer.byteLength(output, 'utf8');

  if (outputBytes > options.maxBytes) {
    let end = Math.min(output.length, options.maxBytes);
    while (end > 0 && Buffer.byteLength(output.slice(0, end), 'utf8') > options.maxBytes) end -= 1;
    output = output.slice(0, end);
    outputBytes = Buffer.byteLength(output, 'utf8');
  }

  return {
    content: output,
    truncated: lines.length > options.maxLines || output.length < content.length,
    outputLines: output ? output.split(/\r?\n/).length : 0,
    totalLines: lines.length,
    outputBytes,
    totalBytes: Buffer.byteLength(content, 'utf8'),
  };
}

function formatTruncatedContent(content: string): { text: string; truncated: boolean } {
  const truncation = truncateHead(content, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
      truncation.outputBytes,
    )} of ${formatSize(truncation.totalBytes)})]`;
  }
  return { text, truncated: truncation.truncated };
}

export async function webFetch(input: { url: string; raw?: boolean }, _ctx?: ExtensionBackendContext) {
  const { url, raw } = input;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: createRequestSignal(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();

    if (!contentType.includes('html') || raw) {
      const formatted = formatTruncatedContent(body);
      return { text: formatted.text, url, contentType, raw: Boolean(raw), truncated: formatted.truncated };
    }

    const readable = await extractReadableHtml({ html: body, url }, _ctx);
    const formatted = formatTruncatedContent(readable.markdown);
    return { text: formatted.text, url, title: readable.title, truncated: formatted.truncated };
  } catch (error) {
    throw new Error(`Error fetching ${url}: ${getErrorMessage(error)}`);
  }
}

export async function duckDuckGoSearch(input: { query: string; count?: number; page?: number }, ctx?: ExtensionBackendContext) {
  const { query, count = 5, page = 1 } = input;
  const maxResults = Math.min(count, 20);
  const offset = (Math.max(page, 1) - 1) * 20;
  const searchParams = new URLSearchParams({ q: query });
  if (offset > 0) {
    searchParams.set('s', String(offset));
    searchParams.set('dc', String(offset + 1));
  }
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  };
  const response = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: searchParams,
    signal: createRequestSignal(10000),
  });
  if (!response.ok) throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`);

  const html = await response.text();
  let results = await parseDuckDuckGoHtml({ html, maxResults }, ctx);

  if (results.length === 0) {
    const liteResponse = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: searchParams,
      signal: createRequestSignal(10000),
    });
    if (!liteResponse.ok) throw new Error(`DuckDuckGo search failed: HTTP ${liteResponse.status}`);
    results = await parseDuckDuckGoHtml({ html: await liteResponse.text(), maxResults }, ctx);
  }

  if (results.length === 0) return { text: `No results found for: ${query} (page ${page})`, query, page, count: 0, source: 'duckduckgo' };

  const resultStart = offset + 1;
  const output = results
    .map((result, index) => `--- Result ${resultStart + index} ---\nTitle: ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`)
    .join('\n\n');
  return {
    text: `DuckDuckGo Search | Page ${page} | Results ${resultStart}-${resultStart + results.length - 1} | Use page: ${page + 1} for more results\n\n${output}`,
    query,
    page,
    count: results.length,
    source: 'duckduckgo',
  };
}
