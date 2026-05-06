# Telemetry

Telemetry explains how Personal Agent records local trace data for the desktop monitoring page.

The desktop app writes turn stats, context pressure, compactions, and tool calls into the local SQLite trace database. The Traces page reads aggregated views from `/api/traces/*` endpoints; writes are fire-and-forget through the trace worker so conversation execution does not wait on analytics.

## Tool telemetry

Tool health groups calls by tool name and tracks call count, errors, success rate, average latency, P95 latency, and max latency. Bash is treated as a first-class subsection because it is the dominant Pi tool: each bash call also stores the submitted command and a normalized command-family label such as `git`, `npm`, or `rg`.

The UI shows the normal per-tool card for `bash`, then a Bash breakdown with the top command families for the selected time range. Existing rows without command metadata are grouped as `unknown`.
