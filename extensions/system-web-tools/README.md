# Web Tools Extension

This extension owns simple web content tools for agent conversations.

## Tools

| Tool                | Parameters                          | Description                           |
| ------------------- | ----------------------------------- | ------------------------------------- |
| `web_fetch`         | `url`, `raw?`                       | Fetch a URL and return text content.  |
| `duckduckgo_search` | `query`, `count?` (max 20), `page?` | Search DuckDuckGo and return results. |

## Web Fetch

Reads a URL and returns raw text for non-HTML responses, or simple tag-stripped text for HTML responses.

```bash
web_fetch(url: "https://example.com/docs/api")
```

Set `raw: true` to return raw HTML/text instead of stripped HTML text.

## DuckDuckGo Search

Posts to DuckDuckGo HTML/Lite search and returns titles, URLs, and snippets. No authentication needed.

## Search parameters

| Parameter | Type   | Default  | Description                |
| --------- | ------ | -------- | -------------------------- |
| `query`   | string | required | Search query               |
| `count`   | number | 5        | Number of results (max 20) |
| `page`    | number | 1        | Page number for pagination |
