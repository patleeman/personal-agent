# Web Tools Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/web-search-fetch.md -->

# Web Search & Fetch

The agent can search the web and read URL content using built-in tools from the web-tools extension.

## Web Search

Searches the web using Exa API (primary) or DuckDuckGo (fallback).

### Exa API

The primary search backend. Provides high-quality search results with snippets, summaries, and metadata.

**API key setup:**

Set `Web tools → Exa API key` in Settings → Security, or export it for the process:

```bash
export EXA_API_KEY=your-key-here
```

When both are set, the environment variable takes precedence.

### DuckDuckGo fallback

Used automatically when no Exa API key is configured. No authentication needed. Results include titles, URLs, and snippets.

### Search results

Each result contains:

| Field        | Description                         |
| ------------ | ----------------------------------- |
| `title`      | Page title                          |
| `url`        | Page URL                            |
| `snippet`    | Text snippet from the page          |
| `highlights` | Matching text highlights (Exa only) |
| `summary`    | Generated summary (Exa only)        |

## Web Fetch

Reads a URL and extracts clean markdown content. Uses Mozilla's Readability for article extraction.

```bash
# The agent fetches a URL
web_fetch(url: "https://example.com/docs/api")
```

### Content limits

| Limit      | Default | Description            |
| ---------- | ------- | ---------------------- |
| `maxBytes` | 50 KB   | Maximum response size  |
| `maxLines` | 2000    | Maximum response lines |

Content beyond these limits is truncated. The tool reports the original size so the agent knows if content was cut off.

## Tools Reference

| Tool         | Parameters                                      | Description                   |
| ------------ | ----------------------------------------------- | ----------------------------- |
| `web_search` | `query`, `count?` (max 20), `page?`             | Search the web                |
| `web_fetch`  | `url`, `raw?` (return HTML instead of markdown) | Fetch and extract URL content |

### web_search parameters

| Parameter | Type   | Default  | Description                |
| --------- | ------ | -------- | -------------------------- |
| `query`   | string | required | Search query               |
| `count`   | number | 5        | Number of results (max 20) |
| `page`    | number | 1        | Page number for pagination |

### web_fetch parameters

| Parameter | Type    | Default  | Description                                   |
| --------- | ------- | -------- | --------------------------------------------- |
| `url`     | string  | required | URL to fetch                                  |
| `raw`     | boolean | false    | Return raw HTML instead of extracted markdown |

## Rate Limits

- Exa API: depends on your Exa plan
- DuckDuckGo: no formal rate limits, but excessive usage may be throttled

Both tools handle rate limiting and network errors gracefully, returning clear error messages.
