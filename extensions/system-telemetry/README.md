# Telemetry Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/telemetry.md -->

# Telemetry

Telemetry explains where Personal Agent stores local observability data, which path is authoritative, and how the Settings and Telemetry pages read it.

## Storage locations

Telemetry is local to the active state root. The default state root is `~/.local/state/personal-agent`, or `$PERSONAL_AGENT_STATE_ROOT` when set.

| Data                      | Location                                                                                  | Role                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Raw app telemetry         | `<state-root>/logs/telemetry/app-telemetry-YYYY-MM-DD[.N].jsonl`                          | Source of truth for generic app events. Append-only JSONL.      |
| Raw trace telemetry       | `<state-root>/logs/telemetry/trace-telemetry-YYYY-MM-DD[.N].jsonl`                        | Source of truth for structured trace events. Append-only JSONL. |
| Telemetry export bundles  | `<state-root>/exports/telemetry/app-telemetry-<timestamp>.jsonl`                          | Bug-report bundles generated from Settings.                     |
| App telemetry query index | `<state-root>/observability/observability.db`                                             | SQLite index for generic app telemetry queries.                 |
| Legacy trace DBs          | `<state-root>/pi-agent/state/trace/*.db` or `<state-root>/sync/pi-agent/state/trace/*.db` | Imported once when present, then deleted after success.         |

The important bit: **raw telemetry lives in JSONL first**. Trace telemetry is calculated from JSONL directly; SQLite is only a best-effort index for generic app telemetry.

## What gets recorded

There are two related telemetry streams:

1. **Trace metrics** — structured records for model usage, token/cost stats, context pressure, compactions, tool calls, tool latency, and agent-loop health. These are written to trace JSONL and aggregated by the telemetry read endpoints on demand.
2. **Application telemetry** — generic runtime events that are useful before they have first-class charts. These are written to JSONL first, then indexed into SQLite best-effort.

Current app telemetry producers include server API request timing, `Server-Timing` headers, server warnings/errors, server app events, renderer route views/leaves, visibility changes, renderer crashes/rejections, conversation stream lifecycle events, prompt submissions, tool execution detail, extension action telemetry, queue drops, and agent-loop lifecycle/latency/outcome events.

## App telemetry event shape

Each JSONL line is one JSON object. The current schema is intentionally loose so new producers can add metadata without a DB migration.

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "ts": "2026-05-14T12:00:00.000Z",
  "source": "server",
  "category": "extension_action",
  "name": "scheduledTask",
  "sessionId": null,
  "runId": null,
  "route": null,
  "status": null,
  "durationMs": 42,
  "count": null,
  "value": null,
  "metadata": { "extensionId": "system-automations", "ok": true }
}
```

Keep `category` low-cardinality and use `metadata` for details. Metadata is bounded before storage; telemetry must never store secrets.

## Write path

The main app telemetry seam is `writeAppTelemetryEvent` in `packages/core/src/app-telemetry-db.ts`.

Write flow:

1. Normalize and bound the event fields.
2. Append the event to `<state-root>/logs/telemetry/*-telemetry-YYYY-MM-DD[.N].jsonl`.
3. For app telemetry only, try to insert the same event into `observability/observability.db` as a derived index.
4. Log telemetry storage failures to stderr/server logs, but do not break app behavior.

The desktop server adds an in-process queue in `packages/desktop/server/traces/appTelemetry.ts` so hot paths can fire-and-forget. If that queue overflows, the app records a `system/telemetry/queue_drop` event before shedding buffered events.

Renderer events go through `POST /api/telemetry/event`. Backend extensions can use `ctx.telemetry.record(...)`, which adds the extension id to metadata, or the SDK seam:

```ts
import { recordTelemetryEvent } from '@personal-agent/extensions/backend/telemetry';

recordTelemetryEvent({ source: 'agent', category: 'my_extension', name: 'action_completed', durationMs: 42 });
```

## Read path

The Telemetry page reads `/api/traces/*` endpoints. Those endpoints combine trace tables and app telemetry queries depending on the panel.

Generic app telemetry reads use `queryAppTelemetryEvents`:

1. Read matching JSONL log events first.
2. Fall back to SQLite when no JSONL events exist, which keeps old indexed data visible.

Extension action telemetry uses the same app telemetry data. `/api/extensions/telemetry` reads `extension_action` events from the telemetry stream, with the old in-memory ring buffer only as an empty-log fallback.

## Settings diagnostics

Settings → Desktop includes a **Telemetry logs** panel. It shows:

- raw log folder path
- file count and total size
- recent JSONL files
- **Open log folder** for local inspection
- **Export JSONL bundle** for bug reports
- **Prune/vacuum DB** to run the app telemetry and trace SQLite cleanup immediately

The export endpoint writes a combined JSONL bundle under `<state-root>/exports/telemetry/` and returns the path so the desktop bridge can open it in Finder. The maintenance endpoint prunes capped app telemetry rows, prunes/caps trace tables, and runs `VACUUM` on the shared observability database.

## Retention and caps

App telemetry has independent log and SQLite limits:

- `PERSONAL_AGENT_APP_TELEMETRY_LOG_RETENTION_DAYS` controls best-effort JSONL file retention. Default: `30` days.
- `PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES` controls size-based rollover within a day. Default: `10485760` bytes. When the daily file would exceed this, writes continue in `app-telemetry-YYYY-MM-DD.1.jsonl`, `.2.jsonl`, and so on.
- `PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS` controls the derived SQLite app telemetry row cap. Default: `50000` rows. Values below `1000` are ignored.
- `PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS` controls the per-table trace cap. Default: `50000` rows. Trace tables also prune rows older than 90 days on open/maintenance.

Retention is best-effort and runs during writes. Manual Settings maintenance runs pruning and SQLite vacuuming on demand. Neither path should crash the app; failures are emitted to the server logs.

## Development rules

- Treat JSONL as the raw truth for app telemetry.
- Treat SQLite as a query/index/cache layer unless the data is inherently aggregate trace data.
- Do not add mandatory migrations for new app telemetry metadata. Add fields inside `metadata` unless the UI needs a real indexed column.
- Do not put secrets, prompts, API keys, or raw credential-bearing payloads into telemetry.
- Keep telemetry writes fire-and-forget. User-visible behavior should not depend on telemetry succeeding, but storage/indexing failures should still emit errors to logs.
