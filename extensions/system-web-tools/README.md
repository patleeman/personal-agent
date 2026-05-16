# Web Tools Extension

This extension owns web content tools for agent conversations.

## Tools

| Tool                | Parameters                          | Description                                |
| ------------------- | ----------------------------------- | ------------------------------------------ |
| `web_fetch`         | `url`, `raw?`                       | Fetch a URL and extract readable markdown. |
| `duckduckgo_search` | `query`, `count?` (max 20), `page?` | Scrape DuckDuckGo HTML search results.     |

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

Exa support is kept as an opt-in backend action, but `exa_search` is not registered as a default agent tool. The default search tool is DuckDuckGo.

## DuckDuckGo Search

Scrapes `https://html.duckduckgo.com/html/` and returns titles, URLs, and snippets. No authentication needed.

## Search parameters

| Parameter | Type   | Default  | Description                |
| --------- | ------ | -------- | -------------------------- |
| `query`   | string | required | Search query               |
| `count`   | number | 5        | Number of results (max 20) |
| `page`    | number | 1        | Page number for pagination |
