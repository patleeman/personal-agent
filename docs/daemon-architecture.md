# Daemon Architecture

## Goal

Introduce one shared background process: `personal-agentd`.

All Personal Agent entrypoints should use this daemon for background work:

- `personal-agent` CLI
- `personal-agent-telegram`
- future integrations

## Why one daemon

- No manual indexing loops
- One scheduler/debouncer for expensive jobs
- One-writer model for shared mutable state
- Consistent behavior across all clients

## Scope

MVP scope:

- local-only daemon (per user, per machine)
- local IPC via Unix socket
- built-in modules (start with `memory`, optional `maintenance`)

Non-goals:

- distributed multi-machine orchestration
- remote network control
- dynamic plugin marketplace

---

## Runtime model

Suggested paths:

- socket: `~/.local/state/personal-agent/daemon/personal-agentd.sock`
- pid: `~/.local/state/personal-agent/daemon/personal-agentd.pid`
- logs: `~/.local/state/personal-agent/daemon/logs/`
- queue/state: `~/.local/state/personal-agent/daemon/`

Clients emit events; daemon handles background processing.

Example events:

- `session.updated`
- `session.closed`
- `memory.reindex.requested`

---

## Event contract (draft)

```json
{
  "id": "evt_01H...",
  "type": "session.closed",
  "source": "cli",
  "timestamp": "2026-02-28T14:30:00Z",
  "payload": {
    "sessionFile": "~/.local/state/personal-agent/pi-agent/sessions/abc.jsonl",
    "profile": "shared",
    "cwd": "/Users/patrick/workingdir/personal-agent"
  }
}
```

---

## Scheduling model

Separate immediate and expensive work:

- immediate: enqueue/metadata updates
- debounced: indexing/embedding/batch tasks

Example policy:

- summarize sessions quickly on event
- `qmd update` every 30–60s while dirty
- `qmd embed` every 5–15m while dirty

---

## Configuration

Suggested config file:

- `~/.config/personal-agent/daemon.json`

Example:

```json
{
  "logLevel": "info",
  "ipc": {
    "socketPath": "~/.local/state/personal-agent/daemon/personal-agentd.sock"
  },
  "modules": {
    "memory": {
      "enabled": true,
      "sessionSource": "~/.local/state/personal-agent/pi-agent/sessions",
      "summaryDir": "~/.local/state/personal-agent/memory/conversations",
      "qmd": {
        "index": "default",
        "updateDebounceSeconds": 45,
        "embedDebounceSeconds": 600
      }
    },
    "maintenance": {
      "enabled": true,
      "cleanupIntervalMinutes": 60
    }
  }
}
```

---

## CLI surface (draft)

- `personal-agent daemon start`
- `personal-agent daemon stop`
- `personal-agent daemon status`
- `personal-agent daemon restart`
- `personal-agent daemon logs`

---

## Integration plan

1. Add `@personal-agent/daemon` package and IPC skeleton
2. Add shared event emitter helper for CLI + Telegram bridge
3. Implement memory module (summarize + qmd update/embed)
4. Add daemon diagnostics (queue depth, last run, last error)
