# Telemetry Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/telemetry.md -->

# Telemetry

Telemetry explains how Personal Agent records local trace data for the desktop monitoring page.

The desktop app writes turn stats, context pressure, compactions, tool calls, logs, app events, and lightweight metrics into one bounded local SQLite observability database at `observability/observability.db`. The Traces page reads aggregated views from `/api/traces/*` endpoints; writes are fire-and-forget through the trace and telemetry queues so conversation execution does not wait on analytics. Token counters are stored and rendered as whole tokens; dollar amounts stay in the separate cost fields.

Legacy `pi-agent/state/trace/trace.db`, `pi-agent/state/trace/app-telemetry.db`, and older `sync/pi-agent/state/trace/*` files are imported into the unified database once per state root, then left untouched.

## Application telemetry

Application telemetry is a generic local event sink for signals that are useful to collect now before the UI has a first-class chart. It writes to the shared observability database through `writeAppTelemetryEvent` and stores source, category, name, session/run ids, route, status, duration, counts, values, and bounded JSON metadata.

Current producers include server API request timing, server `Server-Timing` metrics, server warn/error logs, server app events, renderer route views/leaves, renderer visibility changes, renderer crashes/rejections, conversation stream connect/snapshot/reconnect events, conversation prompt submissions, tool execution detail, and agent loop lifecycle/latency/outcome events. The endpoint for renderer events is `POST /api/telemetry/event`; it is intentionally fire-and-forget and must never block or break the app. If the in-process app telemetry queue overflows, the app records a `system/telemetry/queue_drop` event before shedding old buffered entries.

## Tool telemetry

Tool health groups calls by tool name and tracks call count, errors, success rate, average latency, P95 latency, and max latency. Bash is treated as a first-class subsection because it is the dominant Pi tool: each bash call also stores the submitted command and a normalized command-family label such as `git`, `npm`, or `rg`.

The UI shows the normal per-tool card for `bash`, then a Bash breakdown with the top command families for the selected time range. Each command family includes call count, command-level error rate, and P95 latency so noisy commands stand out without opening raw traces. Existing rows without command metadata are grouped as `unknown`.

## Agent loop health

Agent loop health combines run stats and tool-call traces for the selected range. It tracks average turns and steps, average/P95 tool calls per run, tool error rate, average tokens per run, subagents per run, runs over 20 turns, stuck runs over 10 minutes, stuck-run rate, and duration percentiles.

## Bash complexity

Bash complexity is computed from the recorded command text at query time. It tracks an average and max complexity score, command count, character count, and how often commands use pipelines, chained operators, redirects, multiline scripts, shell control flow, or command substitution. The score is intentionally blunt: more command segments, pipes, redirects, shell control flow, substitutions, and long commands push it up. This makes it easy to see when Pi is using bash as a tiny command runner versus a pocket-sized deployment script in a trench coat.
