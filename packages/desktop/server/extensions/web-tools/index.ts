import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
} from "@mariozechner/pi-coding-agent";

// Read Exa API key: env var first, then auth.json (via context).
function getExaApiKey(ctx?: ExtensionContext): string | undefined {
	const fromEnv = process.env.EXA_API_KEY?.trim();
	if (fromEnv) {
		return fromEnv;
	}

	if (ctx?.modelRegistry?.authStorage) {
		const credential = ctx.modelRegistry.authStorage.get("exa");
		if (credential?.type === "api_key" && credential.key) {
			return credential.key.trim();
		}
	}

	return undefined;
}

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
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function createRequestSignal(signal: unknown, timeoutMs: number): AbortSignal {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	if (!(signal instanceof AbortSignal)) {
		return timeoutSignal;
	}

	try {
		return AbortSignal.any([signal, timeoutSignal]);
	} catch {
		return timeoutSignal;
	}
}

export default function (pi: ExtensionAPI) {
	// ── web_fetch: Fetch a URL and extract readable content as markdown ──
	pi.registerTool({
		name: "web_fetch",
		label: "Fetch Web Page",
		description:
			"Fetch a URL and extract its readable content as markdown. Useful for reading documentation, articles, API references, or any web page. Returns clean markdown text extracted from the page.",
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			raw: Type.Optional(
				Type.Boolean({
					description: "Return raw HTML instead of extracted markdown (default: false)",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { url, raw } = params;
			try {
				const response = await fetch(url, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					},
					signal: createRequestSignal(signal, 15000),
				});

				if (!response.ok) {
					return {
						content: [{ type: "text" as const, text: `HTTP ${response.status}: ${response.statusText}` }],
						details: { url, status: response.status, statusText: response.statusText },
						isError: true,
					};
				}

				const contentType = response.headers.get("content-type") || "";

				// Handle non-HTML content (JSON, plain text, etc.)
				if (!contentType.includes("html")) {
					const text = await response.text();
					const truncation = truncateHead(text, {
						maxLines: DEFAULT_MAX_LINES,
						maxBytes: DEFAULT_MAX_BYTES,
					});
					let result = truncation.content;
					if (truncation.truncated) {
						result += `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
					}
					return {
						content: [{ type: "text" as const, text: result }],
						details: { url, contentType, truncated: truncation.truncated },
					};
				}

				const html = await response.text();

				if (raw) {
					const truncation = truncateHead(html, {
						maxLines: DEFAULT_MAX_LINES,
						maxBytes: DEFAULT_MAX_BYTES,
					});
					let result = truncation.content;
					if (truncation.truncated) {
						result += `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
					}
					return {
						content: [{ type: "text" as const, text: result }],
						details: { url, contentType, raw: true, truncated: truncation.truncated },
					};
				}

				// Extract readable content using Readability + Turndown
				const { JSDOM } = await import("jsdom");
				const { Readability } = await import("@mozilla/readability");
				const TurndownModule = await import("turndown");
				const Turndown = TurndownModule.default || TurndownModule;

				const dom = new JSDOM(html, { url });
				const reader = new Readability(dom.window.document);
				const article = reader.parse();

				let markdown: string;
				if (article && article.content) {
					const td = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced" });
					markdown = td.turndown(article.content);
					if (article.title) {
						markdown = `# ${article.title}\n\n${markdown}`;
					}
				} else {
					// Fallback: strip tags roughly
					const fallbackDom = new JSDOM(html, { url });
					const body = fallbackDom.window.document;
					body.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el: Element) => el.remove());
					const main = body.querySelector("main, article, [role='main'], .content, #content") || body.body;
					const text = main?.textContent || "";
					markdown = text.replace(/\s+/g, " ").trim();
					if (!markdown) {
						return {
							content: [{ type: "text" as const, text: "(Could not extract readable content from page)" }],
							details: { url },
						};
					}
				}

				// Clean up markdown
				markdown = markdown
					.replace(/ +/g, " ")
					.replace(/\n{3,}/g, "\n\n")
					.trim();

				const truncation = truncateHead(markdown, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});
				let result = truncation.content;
				if (truncation.truncated) {
					result += `\n\n[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})]`;
				}

				return {
					content: [{ type: "text" as const, text: result }],
					details: { url, title: article?.title, truncated: truncation.truncated },
				};
			} catch (e: unknown) {
				return {
					content: [{ type: "text" as const, text: `Error fetching ${url}: ${getErrorMessage(e)}` }],
					details: { url, error: getErrorMessage(e) },
					isError: true,
				};
			}
		},
	});

	// ── web_search: Search the web via Exa API (primary) or DuckDuckGo HTML scraping (fallback) ──
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using Exa API when EXA_API_KEY env var or an 'exa' credential in auth.json is configured. Falls back to DuckDuckGo when Exa is unavailable. Returns titles, URLs, and snippets for each result. Use web_fetch to read full page content from the returned URLs. Use page parameter to paginate through results.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (default: 5, max: 20)",
				}),
			),
			page: Type.Optional(
				Type.Number({
					description: "Page number for pagination (default: 1). Each page returns up to ~20 results. Page 2 starts at result 21, etc.",
				}),
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const { query, count = 5, page = 1 } = params;
			const maxResults = Math.min(count, 20);
			const offset = (Math.max(page, 1) - 1) * 20;

			// Try Exa API first if API key is available
			const exaApiKey = getExaApiKey(ctx);
			if (exaApiKey) {
				try {
					const requestedResults = Math.min(offset + maxResults, 100);
					const response = await fetch("https://api.exa.ai/search", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${exaApiKey}`,
						},
						body: JSON.stringify({
							query,
							numResults: requestedResults,
							contents: {
								text: true,
								highlights: true,
							},
						}),
						signal: createRequestSignal(signal, 10000),
					});

					if (!response.ok) {
						// If Exa fails, fall through to DuckDuckGo
						console.log(`Exa API returned ${response.status}, falling back to DuckDuckGo`);
					} else {
						const data = await response.json() as ExaSearchResponse;
						const results = (data.results ?? []).slice(offset, offset + maxResults);

						if (results.length === 0) {
							return {
								content: [{ type: "text" as const, text: `No results found for: ${query}` }],
								details: { query, page, count: 0, source: "exa" },
							};
						}

						const resultStart = offset + 1;
						const output = results
							.map(
								(r, i: number) => {
									// Get snippet from various possible Exa response fields
									let snippet = r.text || "";
									if (!snippet && r.highlights && r.highlights.length > 0) {
										snippet = r.highlights[0];
									}
									if (!snippet && r.summary) {
										snippet = r.summary;
									}
									// Truncate snippet if too long
									if (snippet.length > 500) {
										snippet = snippet.slice(0, 500) + "...";
									}
									return `--- Result ${resultStart + i} ---\nTitle: ${r.title || "(no title)"}\nURL: ${r.url}\nSnippet: ${snippet || "(no snippet available)"}`;
								},
							)
							.join("\n\n");

						const header = `Exa Search | Page ${page} | Results ${resultStart}-${resultStart + results.length - 1} | Use page: ${page + 1} for more results\n\n`;

						return {
							content: [{ type: "text" as const, text: header + output }],
							details: { query, page, count: results.length, source: "exa" },
						};
					}
				} catch (e: unknown) {
					// Exa failed, fall through to DuckDuckGo
					console.log(`Exa API error: ${getErrorMessage(e)}, falling back to DuckDuckGo`);
				}
			}

			// Fallback to DuckDuckGo HTML scraping
			try {
				const searchParams = new URLSearchParams({ q: query });
				if (offset > 0) {
					searchParams.set("s", String(offset));
					searchParams.set("dc", String(offset + 1));
				}
				const searchUrl = `https://html.duckduckgo.com/html/?${searchParams.toString()}`;
				const response = await fetch(searchUrl, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
						Accept: "text/html,application/xhtml+xml",
					},
					signal: createRequestSignal(signal, 10000),
				});

				if (!response.ok) {
					return {
						content: [{ type: "text" as const, text: `Search failed: HTTP ${response.status}` }],
						details: { query, page, status: response.status },
						isError: true,
					};
				}

				const html = await response.text();
				const { JSDOM } = await import("jsdom");
				const dom = new JSDOM(html);
				const doc = dom.window.document;

				const resultElements = doc.querySelectorAll(".result");
				const results: Array<{ title: string; url: string; snippet: string }> = [];

				resultElements.forEach((el: Element) => {
					if (results.length >= maxResults) return;

					const titleEl = el.querySelector(".result__title a, .result__a");
					const snippetEl = el.querySelector(".result__snippet");

					if (!titleEl) return;

					const title = titleEl.textContent?.trim() || "";
					let href = titleEl.getAttribute("href") || "";

					// DuckDuckGo wraps URLs in a redirect; extract the actual URL
					if (href.includes("uddg=")) {
						const match = href.match(/uddg=([^&]+)/);
						if (match) {
							href = decodeURIComponent(match[1]);
						}
					}

					const snippet = snippetEl?.textContent?.trim() || "";

					if (title && href) {
						results.push({ title, url: href, snippet });
					}
				});

				if (results.length === 0) {
					return {
						content: [{ type: "text" as const, text: `No results found for: ${query} (page ${page})` }],
						details: { query, page, count: 0, source: "duckduckgo" },
					};
				}

				const resultStart = offset + 1;
				const output = results
					.map(
						(r, i) =>
							`--- Result ${resultStart + i} ---\nTitle: ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`,
					)
					.join("\n\n");

				const header = `DuckDuckGo Search | Page ${page} | Results ${resultStart}-${resultStart + results.length - 1} | Use page: ${page + 1} for more results\n\n`;

				return {
					content: [{ type: "text" as const, text: header + output }],
					details: { query, page, count: results.length, source: "duckduckgo" },
				};
			} catch (e: unknown) {
				return {
					content: [{ type: "text" as const, text: `Search error: ${getErrorMessage(e)}` }],
					details: { query, page, error: getErrorMessage(e) },
					isError: true,
				};
			}
		},
	});
}
