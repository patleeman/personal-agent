import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface ReadableHtmlResult {
  markdown: string;
  title?: string;
}

export interface SearchHtmlResult {
  title: string;
  url: string;
  snippet: string;
}

export async function extractReadableHtml(input: { html: string; url: string }): Promise<ReadableHtmlResult> {
  let markdown: string;
  let title: string | undefined;

  try {
    const { JSDOM } = require('jsdom') as typeof import('jsdom');
    const { Readability } = require('@mozilla/readability') as typeof import('@mozilla/readability');
    const TurndownModule = require('turndown') as typeof import('turndown') | { default: typeof import('turndown') };
    const Turndown = 'default' in TurndownModule ? TurndownModule.default : TurndownModule;

    const dom = new JSDOM(input.html, { url: input.url });
    const article = new Readability(dom.window.document).parse();
    title = article?.title;

    if (article?.content) {
      const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      markdown = td.turndown(article.content);
      if (article.title) markdown = `# ${article.title}\n\n${markdown}`;
    } else {
      markdown = extractTextFallback(input.html);
    }
  } catch {
    markdown = extractTextFallback(input.html);
  }

  markdown = markdown
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!markdown) return { markdown: '(Could not extract readable content from page)' };
  return { markdown, ...(title ? { title } : {}) };
}

function extractTextFallback(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function parseDuckDuckGoHtml(input: { html: string; maxResults: number }): Promise<SearchHtmlResult[]> {
  const { JSDOM } = require('jsdom') as typeof import('jsdom');
  const document = new JSDOM(input.html).window.document;
  const results: SearchHtmlResult[] = [];

  document.querySelectorAll('.result, tr').forEach((element: Element) => {
    if (results.length >= input.maxResults) return;
    const titleElement = element.querySelector('.result__title a, .result__a, a.result-link, a[href*="uddg="], a[href^="http"]');
    const snippetElement = element.querySelector('.result__snippet, .result-snippet, td.result-snippet');
    if (!titleElement) return;
    const title = titleElement.textContent?.replace(/\s+/g, ' ').trim() || '';
    let href = titleElement.getAttribute('href') || '';
    if (href.includes('uddg=')) {
      const match = href.match(/uddg=([^&]+)/);
      if (match) href = decodeURIComponent(match[1]!);
    }
    if (href.startsWith('//duckduckgo.com/l/?')) {
      const parsed = new URL(`https:${href}`);
      href = parsed.searchParams.get('uddg') || href;
    }
    const snippet = snippetElement?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (title && href && !href.includes('duckduckgo.com/y.js')) results.push({ title, url: href, snippet });
  });

  return results;
}
