# Daemon Architecture

## Goal

`personal-agentd` is the shared local background process used by:

- `pa` CLI launches
- `pa gateway` processes
- scheduled task execution

It centralizes background orchestration so clients can stay thin.

---

## Core model

The daemon is an **in-process event bus** behind a local IPC interface.

- Clients publish events over Unix socket JSONL IPC
- Modules subscribe to event types and handle work
- Timers emit normal events into the same queue
- Modules expose status for diagnostics

Queue behavior:

- bounded depth (`queue.maxDepth`)
- at-most-once delivery
- events can be dropped when queue is saturated

---

## Runtime paths

Default root:

- `~/.local/state/personal-agent/daemon`

Default files:

- socket: `personal-agentd.sock`
- pid: `personal-agentd.pid`
- log: `logs/daemon.log`
- task runtime state: `task-state.json`
- task run logs: `task-runs/**`

---

## Built-in modules

## `maintenance`

- periodic cleanup tasks (for example daemon log retention)

## `tasks`

- discovers `*.task.md` files from configured task directory
- parses frontmatter + prompt body
- schedules cron/at tasks
- executes tasks with retries and timeout (direct daemon-managed subprocess by default; tmux optional)
- writes per-run logs and updates task state
- creates durable profile activity entries for successful/failed task runs when task files live under profile resources
- publishes `gateway.notification` events when `output` routing is configured

See [Scheduled Tasks](./tasks.md) for schema details.

## `deferred-resume`

- watches queued deferred-resume state under the runtime Pi state root
- marks due conversation continuations as ready even when no TUI is open
- creates durable profile activity entries when a deferred resume fires
- leaves actual prompt delivery to the matching conversation runtime when that conversation is active or reopened

---

## Event contract

Common event types in current flows:

- `session.updated`
- `session.closed`
- `session.processing.failed`
- `pi.run.completed`
- `pi.run.failed`
- `timer.maintenance.cleanup`
- `timer.tasks.tick`
- `gateway.notification`

Event envelope:

```json
{
  "id": "evt_01H...",
  "version": 1,
  "type": "session.closed",
  "source": "cli",
  "timestamp": "2026-02-28T14:30:00Z",
  "payload": { "...": "..." }
}
```

---

## IPC protocol (JSON lines)

Requests are one JSON object per line over the Unix socket.

### Emit event

```json
{"id":"req_1","type":"emit","event":{...}}
```

### Read daemon status

```json
{"id":"req_2","type":"status"}
```

### Stop daemon

```json
{"id":"req_3","type":"stop"}
```

### Pull gateway notifications

```json
{"id":"req_4","type":"notifications.pull","gateway":"telegram","limit":50}
```

Responses:

```json
{"id":"req_2","ok":true,"result":{...}}
```

or

```json
{"id":"req_2","ok":false,"error":"..."}
```

---

## Configuration

Primary file:

- `~/.config/personal-agent/daemon.json`

Override path via:

- `PERSONAL_AGENT_DAEMON_CONFIG`

Example:

```json
{
  "logLevel": "info",
  "queue": { "maxDepth": 1000 },
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
      "taskDir": "/path/to/personal-agent/profiles/<active-profile>/agent/tasks",
      "tickIntervalSeconds": 30,
      "maxRetries": 3,
      "reapAfterDays": 7,
      "defaultTimeoutSeconds": 1800,
      "runTasksInTmux": false
    }
  }
}
```

If `modules.tasks.taskDir` is omitted, daemon defaults to `<repo>/profiles/<active-profile>/agent/tasks`, where `<active-profile>` resolves from `PERSONAL_AGENT_PROFILE` or `defaultProfile` in `~/.config/personal-agent/config.json` (fallback: `shared`).

`PERSONAL_AGENT_DAEMON_SOCKET_PATH` can set the default socket path if `ipc.socketPath` is not set in file config.

---

## CLI surface

```bash
pa daemon
pa daemon status [--json]
pa daemon start
pa daemon stop
pa daemon restart
pa daemon logs
pa daemon service [install|status|uninstall|help]
```

Task companion commands:

```bash
pa tasks list|show|validate|logs
```

---

## Failure behavior

If daemon is unavailable, clients (CLI/gateway) continue in degraded mode and warn instead of hard-failing.

You can intentionally disable daemon integration with:

- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1`
