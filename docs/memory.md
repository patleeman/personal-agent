# Memory Module

## Overview

`personal-agentd` includes a built-in memory module implemented in:

- `packages/daemon/src/modules/memory.ts`
- `packages/daemon/src/modules/memory-config.ts`
- `packages/daemon/src/modules/memory-store.ts`
- `packages/daemon/src/modules/memory-transcript.ts`
- `packages/daemon/src/modules/memory-summarizer.ts`

The module scans Pi session files, summarizes concluded sessions into markdown, and keeps qmd indexes fresh.

Durable profile memory is handled separately in repo-managed `MEMORY.md` files (one per profile) and injected at runtime by the memory extension.

## Default paths

- Daemon config: `~/.config/personal-agent/daemon.json`
- Session source: `~/.local/state/personal-agent/pi-agent/sessions`
- Summary root: `~/.local/state/personal-agent/memory/conversations`
- Memory state file: `~/.local/state/personal-agent/memory/session-state.json`
- qmd cache/index: `~/.cache/qmd/`
- Durable memory (repo-managed): `<repo>/profiles/<profile>/agent/MEMORY.md`

## Event subscriptions and timers

### Subscriptions

- `session.updated`
- `session.closed`
- `memory.reindex.requested`
- `timer.memory.session.scan`
- `timer.memory.qmd.update`
- `timer.memory.qmd.reconcile`
- `timer.memory.qmd.embed`

### Timers

- `timer.memory.session.scan`: every `scanIntervalMinutes` (minimum 60s)
- `timer.memory.qmd.update`: every `qmd.updateDebounceSeconds` (minimum 5s)
- `timer.memory.qmd.reconcile`: every `qmd.reconcileIntervalMinutes` (minimum 1m)
- `timer.memory.qmd.embed`: every `qmd.embedDebounceSeconds` (minimum 30s)

## Startup behavior

On startup, the memory module:

1. creates summary and state directories (`0700`)
2. loads `session-state.json` (or initializes empty state)
3. ensures configured qmd collections exist (typically `conversations`)
4. runs an immediate scan pass

## Session processing flow

### 1) Candidate discovery

Each scan pass recursively finds `*.jsonl` under `sessionSource` and merges any hinted session files received from `session.updated` / `session.closed` events.

### 2) Concluded-session detection

A session is eligible only when:

- `now - sessionFile.mtime >= inactiveAfterMinutes`

Active/recent files are skipped.

### 3) Idempotency / change detection

Each processed session is tracked in `session-state.json` with:

- fingerprint: `"<size>:<mtimeMs>"`
- artifact path (`.md` summary or `.skip` low-signal marker)
- workspace key
- session id
- processed timestamp

If fingerprint is unchanged, the session is skipped.

### 4) Transcript extraction and compaction

The parser reads session JSONL and produces a compact transcript:

Included:
- user text turns
- assistant text turns
- `TOOL_CALL` metadata with compact argument highlights (`path`, `command`, etc.)
- `TOOL_ERROR` lines for failed tool results

Excluded:
- assistant thinking blocks
- non-error raw tool result payloads
- large payload dumps

Compaction limits:
- `maxTurns`
- `maxCharsPerTurn`
- `maxTranscriptChars`

Low-signal filter:
- approximate transcript token count is computed via whitespace splitting
- if transcript tokens are below `minTranscriptTokens`, summarization is skipped
- skipped sessions get a `.skip` marker under `<summaryDir>/.skipped/...` for idempotency

### 5) Pi SDK summarization

For high-signal sessions, the module runs one Pi SDK prompt to produce a human markdown summary.

It uses:

- `SessionManager.inMemory()`
- `tools: []`
- `cwd` set to `summaryDir` (to keep context/token usage predictable)
- `agentDir` inferred from session source (typically `.../pi-agent`)

Guardrail:
- summarization fails if `session.sessionFile` is not `undefined`

This prevents creating new persisted Pi conversations during summarization.

### 6) Output artifacts

Summary files are written to:

- `<summaryDir>/<workspace-key>/<session-id>.md`

Where:
- `workspace-key` is a slug derived from session `cwd`
- `session-id` is sanitized for filesystem safety

Low-signal sessions do not produce markdown summaries. They write:

- `<summaryDir>/.skipped/<workspace-key>/<session-id>.skip`

When summary content changes, module publishes:
- `memory.summary.updated`

and marks:
- `dirty = true`
- `needsEmbedding = true`

## Retention cleanup

Every scan pass also runs retention cleanup:

- deletes summary markdown files older than `retentionDays`
- removes stale entries from `session-state.json`
- prunes empty summary directories

Any deletion marks qmd as dirty/needs embedding.

## qmd indexing lifecycle

- On `timer.memory.qmd.update`, when `dirty === true`:
  - runs `qmd update --index <index>`
  - sets `dirty = false`
  - publishes `memory.qmd.update.completed`

- On `timer.memory.qmd.reconcile` (hourly by default), regardless of `dirty`:
  - runs `qmd update --index <index>`
  - sets `dirty = false`
  - updates `lastQmdReconcileAt`
  - publishes `memory.qmd.update.completed`

- On `timer.memory.qmd.embed`, when `needsEmbedding === true` and `dirty === false`:
  - runs `qmd embed --index <index>`
  - sets `needsEmbedding = false`
  - publishes `memory.qmd.embed.completed`

## Runtime memory injection (Pi extension)

A dedicated extension (`profiles/shared/agent/extensions/memory-cards`) injects durable profile memory per prompt via `before_agent_start`:

- loads durable profile memory from `profiles/<active-profile>/agent/MEMORY.md` (fallback: `shared`)
- injects the durable memory as a capped `DURABLE_MEMORY` block
- does **not** auto-query episodic memory at prompt time (to avoid added message latency)
- relies on on-demand `qmd query` via `bash` when episodic recall is needed

The same extension also registers a `memory_update` tool that:

- applies durable memory changes (`upsert` / `remove` / `replace`)
- writes `profiles/<profile>/agent/MEMORY.md`
- runs `git add`, `git commit`, and `git push` when content changes

Optional tuning env vars for the extension:
- `PERSONAL_AGENT_DURABLE_MEMORY_MAX_TOKENS`
- `PERSONAL_AGENT_ACTIVE_PROFILE`
- `PERSONAL_AGENT_REPO_ROOT`

## Durable memory file template

`profiles/<profile>/agent/MEMORY.md` is intentionally simple markdown:

```md
# Durable Memory

## User

## Preferences

## Environment

## Constraints

## Do Not Store
- Secrets, credentials, API keys, tokens
- Session-only or temporary task notes
```

Updates are applied through `memory_update` to keep formatting and git workflow consistent.

## Current config shape

```json
{
  "modules": {
    "memory": {
      "enabled": true,
      "sessionSource": "~/.local/state/personal-agent/pi-agent/sessions",
      "summaryDir": "~/.local/state/personal-agent/memory/conversations",
      "scanIntervalMinutes": 5,
      "inactiveAfterMinutes": 30,
      "retentionDays": 90,
      "collections": [
        {
          "name": "conversations",
          "path": "~/.local/state/personal-agent/memory/conversations",
          "mask": "**/*.md"
        }
      ],
      "summarization": {
        "provider": "pi-sdk",
        "maxTurns": 250,
        "maxCharsPerTurn": 600,
        "maxTranscriptChars": 18000,
        "minTranscriptTokens": 30
      },
      "qmd": {
        "index": "default",
        "updateDebounceSeconds": 45,
        "embedDebounceSeconds": 600,
        "reconcileIntervalMinutes": 60
      }
    }
  }
}
```

## Diagnostics status fields

`memory.getStatus()` exposes:

- `dirty`
- `needsEmbedding`
- `lastScanAt`
- `lastCleanupAt`
- `lastSummaryAt`
- `lastQmdUpdateAt`
- `lastQmdReconcileAt`
- `lastQmdEmbedAt`
- `scannedSessions`
- `summarizedSessions`
- `skippedSessions`
- `failedSessions`
- `deletedSummaries`
- `pendingHintedSessions`
- `stateFile`
- `agentDir`
- `summaryDir`
- `lastError`
