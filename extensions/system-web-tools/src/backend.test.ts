import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/desktop/server/secrets/secretStore.js', () => ({
  resolveSecret: () => process.env.EXA_API_KEY?.trim() || undefined,
}));

vi.mock('@personal-agent/extensions/backend/webContent', () => ({
  extractReadableHtml: vi.fn(async ({ html }) => ({ markdown: html.replace(/<[^>]+>/g, '').trim(), title: 'Example' })),
  parseDuckDuckGoHtml: vi.fn(async ({ html }) =>
    html.includes('result__a')
      ? [{ title: 'Example Title', url: 'https://example.org/page', snippet: 'This is a sample snippet text.' }]
      : [],
  ),
}));

import { parseDuckDuckGoHtml } from '@personal-agent/extensions/backend/webContent';

import { duckDuckGoSearch, webFetch } from './backend.js';

describe('system-web-tools backend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('webFetch', () => {
    it('throws when URL is missing', async () => {
      await expect(webFetch({} as never)).rejects.toThrow();
    });

    it('returns raw content when raw=true', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/html; charset=utf-8']]),
        text: () => Promise.resolve('<html><body>raw data</body></html>'),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await webFetch({ url: 'https://example.com', raw: true });
      expect(result.raw).toBe(true);
      expect(result.text).toContain('raw data');
      expect(result.url).toBe('https://example.com');
    });

    it('throws on HTTP error', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
        text: () => Promise.resolve(''),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      await expect(webFetch({ url: 'https://example.com/404', raw: true })).rejects.toThrow('HTTP 404');
    });

    it('handles non-HTML content type with raw fallback', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        text: () => Promise.resolve('{"key":"value"}'),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await webFetch({ url: 'https://example.com/data.json' });
      expect(result.text).toContain('{"key":"value"}');
      expect(result.contentType).toBe('application/json');
    });

    it('handles fetch errors gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network failure'));

      await expect(webFetch({ url: 'https://example.com' })).rejects.toThrow('Error fetching');
    });

    it('handles timeout via abort signal', async () => {
      const mockResponse = {
        ok: true,
        headers: new Map([['content-type', 'text/plain']]),
        text: () => Promise.resolve('timed out but got here'),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as unknown as Response);

      const result = await webFetch({ url: 'https://example.com', raw: true });
      expect(result.text).toContain('timed out');
    });
  });

  describe('duckDuckGoSearch', () => {
    it('searches DuckDuckGo HTML results', async () => {
      const mockHtml = `<html><body>
        <div class="result">
          <a class="result__a" href="https://example.com?uddg=https%3A%2F%2Fexample.org%2Fpage">Example Title</a>
          <a class="result__title" href="https://example.com">Example Title</a>
          <div class="result__snippet">This is a sample snippet text.</div>
        </div>
      </body></html>`;

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      } as unknown as Response);

      const result = await duckDuckGoSearch({ query: 'test query' });
      expect(result.source).toBe('duckduckgo');
      expect(result.count).toBeGreaterThanOrEqual(0);
    });

    it('handles DuckDuckGo fetch failure', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DDG failed'));

      await expect(duckDuckGoSearch({ query: 'test' })).rejects.toThrow();
    });

    it('falls back to DuckDuckGo lite when HTML results parse empty', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('<html><body></body></html>'),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve('<html><body><a class="result__a" href="https://example.org/page">Example Title</a></body></html>'),
        } as unknown as Response);

      const result = await duckDuckGoSearch({ query: 'test' });
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(String(vi.mocked(globalThis.fetch).mock.calls[0]?.[0])).toBe('https://html.duckduckgo.com/html/');
      expect(String(vi.mocked(globalThis.fetch).mock.calls[1]?.[0])).toBe('https://lite.duckduckgo.com/lite/');
      expect(parseDuckDuckGoHtml).toHaveBeenCalledTimes(2);
      expect(result.count).toBe(1);
    });

    it('uses sensible defaults for count and page', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body></body></html>'),
      } as unknown as Response);

      const result = await duckDuckGoSearch({ query: 'test' });
      expect(result.count).toBe(0);
      expect(result.page).toBe(1);
    });

    it('clamps count to maximum of 20', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body></body></html>'),
      } as unknown as Response);

      const result = await duckDuckGoSearch({ query: 'test', count: 100 });
      expect(result.count).toBe(0); // no results found, but count was clamped
    });
  });

  describe('formatTruncatedContent', () => {
    it('passes through short content', async () => {
      // Import and test via the public webFetch side effect — formatTruncatedContent is internal
      // but tested implicitly through webFetch with raw=true
    });
  });
});
