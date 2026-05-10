import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent';

import { resolveSecret } from '../../../packages/desktop/server/secrets/secretStore.js';

interface ExaSearchResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  summary?: string;
}

interface ExaSearchResponse {
  results?: ExaSearchResult[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createRequestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function getExaApiKey(): string | undefined {
  return resolveSecret('system-web-tools', 'exaApiKey');
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

export async function webFetch(input: { url: string; raw?: boolean }) {
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

    const { JSDOM } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');
    const TurndownModule = await import('turndown');
    const Turndown = TurndownModule.default || TurndownModule;

    const dom = new JSDOM(body, { url });
    const article = new Readability(dom.window.document).parse();
    let markdown: string;

    if (article?.content) {
      const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      markdown = td.turndown(article.content);
      if (article.title) markdown = `# ${article.title}\n\n${markdown}`;
    } else {
      const fallbackDom = new JSDOM(body, { url });
      const document = fallbackDom.window.document;
      document.querySelectorAll('script, style, noscript, nav, header, footer, aside').forEach((element: Element) => element.remove());
      const main = document.querySelector("main, article, [role='main'], .content, #content") || document.body;
      markdown = (main?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!markdown) return { text: '(Could not extract readable content from page)', url };
    }

    markdown = markdown
      .replace(/ +/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const formatted = formatTruncatedContent(markdown);
    return { text: formatted.text, url, title: article?.title, truncated: formatted.truncated };
  } catch (error) {
    throw new Error(`Error fetching ${url}: ${getErrorMessage(error)}`);
  }
}

export async function webSearch(input: { query: string; count?: number; page?: number }) {
  const { query, count = 5, page = 1 } = input;
  const maxResults = Math.min(count, 20);
  const offset = (Math.max(page, 1) - 1) * 20;
  const exaApiKey = getExaApiKey();

  if (exaApiKey) {
    try {
      const requestedResults = Math.min(offset + maxResults, 100);
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${exaApiKey}` },
        body: JSON.stringify({ query, numResults: requestedResults, contents: { text: true, highlights: true } }),
        signal: createRequestSignal(10000),
      });

      if (response.ok) {
        const data = (await response.json()) as ExaSearchResponse;
        const results = (data.results ?? []).slice(offset, offset + maxResults);
        if (results.length === 0) return { text: `No results found for: ${query}`, query, page, count: 0, source: 'exa' };

        const resultStart = offset + 1;
        const output = results
          .map((result, index) => {
            let snippet = result.text || result.highlights?.[0] || result.summary || '';
            if (snippet.length > 500) snippet = `${snippet.slice(0, 500)}...`;
            return `--- Result ${resultStart + index} ---\nTitle: ${result.title || '(no title)'}\nURL: ${result.url}\nSnippet: ${
              snippet || '(no snippet available)'
            }`;
          })
          .join('\n\n');
        return {
          text: `Exa Search | Page ${page} | Results ${resultStart}-${resultStart + results.length - 1} | Use page: ${
            page + 1
          } for more results\n\n${output}`,
          query,
          page,
          count: results.length,
          source: 'exa',
        };
      }
    } catch {
      // Fall back to DuckDuckGo.
    }
  }

  const searchParams = new URLSearchParams({ q: query });
  if (offset > 0) {
    searchParams.set('s', String(offset));
    searchParams.set('dc', String(offset + 1));
  }
  const response = await fetch(`https://html.duckduckgo.com/html/?${searchParams.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: createRequestSignal(10000),
  });
  if (!response.ok) throw new Error(`Search failed: HTTP ${response.status}`);

  const html = await response.text();
  const { JSDOM } = await import('jsdom');
  const document = new JSDOM(html).window.document;
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  document.querySelectorAll('.result').forEach((element: Element) => {
    if (results.length >= maxResults) return;
    const titleElement = element.querySelector('.result__title a, .result__a');
    const snippetElement = element.querySelector('.result__snippet');
    if (!titleElement) return;
    const title = titleElement.textContent?.trim() || '';
    let href = titleElement.getAttribute('href') || '';
    if (href.includes('uddg=')) {
      const match = href.match(/uddg=([^&]+)/);
      if (match) href = decodeURIComponent(match[1]);
    }
    const snippet = snippetElement?.textContent?.trim() || '';
    if (title && href) results.push({ title, url: href, snippet });
  });

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
