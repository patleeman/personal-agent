export interface ReadableHtmlResult {
  markdown: string;
  title?: string;
}

export interface SearchHtmlResult {
  title: string;
  url: string;
  snippet: string;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

export async function extractReadableHtml(input: { html: string; url: string }): Promise<ReadableHtmlResult> {
  const { JSDOM } = await dynamicImport<typeof import('jsdom')>('jsdom');
  const { Readability } = await dynamicImport<typeof import('@mozilla/readability')>('@mozilla/readability');
  const TurndownModule = await dynamicImport<typeof import('turndown')>('turndown');
  const Turndown = (TurndownModule as unknown as { default?: typeof TurndownModule }).default || TurndownModule;

  const dom = new JSDOM(input.html, { url: input.url });
  const article = new Readability(dom.window.document).parse();
  let markdown: string;

  if (article?.content) {
    const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    markdown = td.turndown(article.content);
    if (article.title) markdown = `# ${article.title}\n\n${markdown}`;
  } else {
    const fallbackDom = new JSDOM(input.html, { url: input.url });
    const document = fallbackDom.window.document;
    document.querySelectorAll('script, style, noscript, nav, header, footer, aside').forEach((element: Element) => element.remove());
    const main = document.querySelector("main, article, [role='main'], .content, #content") || document.body;
    markdown = (main?.textContent || '').replace(/\s+/g, ' ').trim();
    if (!markdown) return { markdown: '(Could not extract readable content from page)' };
  }

  markdown = markdown
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, ...(article?.title ? { title: article.title } : {}) };
}

export async function parseDuckDuckGoHtml(input: { html: string; maxResults: number }): Promise<SearchHtmlResult[]> {
  const { JSDOM } = await dynamicImport<typeof import('jsdom')>('jsdom');
  const document = new JSDOM(input.html).window.document;
  const results: SearchHtmlResult[] = [];

  document.querySelectorAll('.result').forEach((element: Element) => {
    if (results.length >= input.maxResults) return;
    const titleElement = element.querySelector('.result__title a, .result__a');
    const snippetElement = element.querySelector('.result__snippet');
    if (!titleElement) return;
    const title = titleElement.textContent?.trim() || '';
    let href = titleElement.getAttribute('href') || '';
    if (href.includes('uddg=')) {
      const match = href.match(/uddg=([^&]+)/);
      if (match) href = decodeURIComponent(match[1]!);
    }
    const snippet = snippetElement?.textContent?.trim() || '';
    if (title && href) results.push({ title, url: href, snippet });
  });

  return results;
}
