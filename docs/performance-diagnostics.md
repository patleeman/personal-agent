# Performance diagnostics

Performance diagnostics expose lightweight renderer timing samples for debugging app jank without attaching a profiler first.

The renderer stores recent samples on `window.__PA_APP_PERF__`. Set `localStorage.pa.debugPerf = '1'` and reload to also print samples to the console.

Conversation navigation records `conversationOpenSamples` with these phases:

- `content` — the conversation page rendered usable transcript content, empty state, or error state.
- `extensions` — the shared extension registry is ready for the conversation route.
- `rail` — the context rail completed its first paint for the conversation.

`chatRenderSamples` record ChatView commit timing plus transcript shape: message count, render item count, mounted/windowed counts, trace clusters, tool blocks, standalone tool blocks, and markdown-like user/assistant blocks.

API samples are recorded when responses include `Server-Timing` or `X-PA-Perf` headers. Keep new diagnostics cheap and side-effect-free; this is a tripwire, not a replacement for browser profiling.
