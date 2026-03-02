# Daemon Architecture

## Goal

Run one shared background process: `personal-agentd`.

All Personal Agent entrypoints send background work to this daemon:

- `pa` CLI
- `pa gateway ...` commands
- future integrations

## Core model

The daemon is an **in-process event bus**.

- Clients publish events over local IPC.
- Modules subscribe to events and handle work.
- Modules can publish follow-up events.
- Scheduled tasks are implemented as timer-emitted events.

This keeps one-writer ownership for mutable daemon state and gives one consistent orchestration path.

## Scope

MVP scope:

- local-only daemon (per user, per machine)
- Unix socket IPC + JSON lines protocol
- built-in modules: `maintenance`, `tasks`
- queue and module diagnostics

Non-goals:

- distributed multi-machine orchestration
- remote network control
- dynamic plugin marketplace

---

## Runtime model

Default paths:

- socket: `~/.local/state/personal-agent/daemon/personal-agentd.sock`
- pid: `~/.local/state/personal-agent/daemon/personal-agentd.pid`
- logs: `~/.local/state/personal-agent/daemon/logs/daemon.log`
- daemon root: `~/.local/state/personal-agent/daemon/`

Clients emit events. Daemon modules process events asynchronously through one queue.

---

## Event contract

```json
{
  "id": "evt_01H...",
  "version": 1,
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

Common event types:

- `session.updated`
- `session.closed`
- `timer.maintenance.cleanup`
- `timer.tasks.tick`

Delivery model (MVP):

- at-most-once delivery
- bounded queue
- drop when queue is full

---

## IPC contract (JSON lines)

Requests are one JSON object per line over Unix socket.

### emit

```json
{"id":"req_1","type":"emit","event":{...}}
```

### status

```json
{"id":"req_2","type":"status"}
```

### stop

```json
{"id":"req_3","type":"stop"}
```

Responses:

```json
{"id":"req_2","ok":true,"result":{...}}
```

or

```json
{"id":"req_2","ok":false,"error":"..."}
```

Client behavior when daemon is unavailable:

- warn and continue (non-fatal)

---

## Module contract

A daemon module can:

- declare subscriptions (`event types`)
- declare timers (`interval -> event type`)
- handle events
- publish events
- expose status for diagnostics

High-level shape:

- `start(context)`
- `handleEvent(event, context)`
- `stop(context)` (optional)
- `getStatus()` (optional)

---

## Scheduling model

No separate scheduler abstraction is required.

- timers are owned by daemon runtime
- each timer emits a normal event into the same queue
- modules handle timer events like any other event

---

## Configuration

Config file:

- `~/.config/personal-agent/daemon.json`

Example:

```json
{
  "logLevel": "info",
  "queue": {
    "maxDepth": 1000
  },
  "ipc": {
    "socketPath": "~/.local/state/personal-agent/daemon/personal-agentd.sock"
  },
  "modules": {
    "maintenance": {
      "enabled": true,
      "cleanupIntervalMinutes": 60
    },
    "tasks": {
      "enabled": true,
      "taskDir": "~/.config/personal-agent/tasks",
      "tickIntervalSeconds": 30,
      "maxRetries": 3,
      "reapAfterDays": 7,
      "defaultTimeoutSeconds": 1800
    }
  }
}
```

Task files are markdown prompts with YAML frontmatter in `taskDir`.
One-time (`at`) tasks are marked complete in state on success and reaped after `reapAfterDays`.

Example:

```md
---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
provider: "openai-codex"
model: "gpt-5.3-codex"
---
Summarize yesterday's work and open follow-up tasks.
```

Starter file: `docs/examples/scheduled-task.task.md`

---

## CLI surface

- `pa daemon` (help)
- `pa daemon start`
- `pa daemon stop`
- `pa daemon status`
- `pa daemon restart`
- `pa daemon logs`
- `pa daemon service install|status|uninstall|help`

---

## Integration status

1. `@personal-agent/daemon` package: scaffolded
2. CLI + gateway non-fatal event emission: wired
3. tasks module: implemented (task discovery, cron/at scheduling, retries, overlap skipping)
4. diagnostics: queue and module status exposed via `daemon status`
