# Web Tools Extension

This extension owns web content tools for agent conversations.

## Tools

| Tool                | Parameters                          | Description                                    |
| ------------------- | ----------------------------------- | ---------------------------------------------- |
| `web_fetch`         | `url`, `raw?`                       | Fetch a URL and extract readable markdown.     |
| `exa_search`        | `query`, `count?` (max 20), `page?` | Search the web using Exa. Requires an API key. |
| `duckduckgo_search` | `query`, `count?` (max 20), `page?` | Scrape DuckDuckGo HTML search results.         |

## Web Fetch

Reads a URL and extracts clean markdown content with Mozilla Readability.

```bash
web_fetch(url: "https://example.com/docs/api")
```

Set `raw: true` to return raw HTML/text instead of extracted markdown. Non-HTML responses are returned as raw text.

### Content limits

| Limit      | Default | Description            |
| ---------- | ------- | ---------------------- |
| `maxBytes` | 50 KB   | Maximum response size  |
| `maxLines` | 2000    | Maximum response lines |

Content beyond these limits is truncated, and the tool reports truncation details.

## Exa Search

Uses the Exa API for web search. Results include titles, URLs, and snippets derived from Exa text/highlights/summary fields.

Set `Web tools → Exa API key` in Settings → Security, or export it for the process:

```bash
export EXA_API_KEY=your-key-here
```

When both are set, the environment variable takes precedence.

## DuckDuckGo Search

Scrapes `https://html.duckduckgo.com/html/` and returns titles, URLs, and snippets. No authentication needed.

## Search parameters

| Parameter | Type   | Default  | Description                |
| --------- | ------ | -------- | -------------------------- |
| `query`   | string | required | Search query               |
| `count`   | number | 5        | Number of results (max 20) |
| `page`    | number | 1        | Page number for pagination |
