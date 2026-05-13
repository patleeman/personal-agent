# Daemon

The daemon is a long-lived background process that owns durable runtime behavior. The desktop app manages it automatically — start and stop happen with the app lifecycle.

## What the Daemon Owns

| Component       | Description                                                               |
| --------------- | ------------------------------------------------------------------------- |
| Runs            | Detached agent work, started from conversations, inspected later          |
| Scheduled tasks | Recurring or one-time automations with cron or natural-language schedules |
| Wakeups         | Conversation callbacks triggered by completed runs and tasks              |
| Companion API   | HTTP/WebSocket endpoint for iOS app and remote clients                    |
| Reminders       | Tell-me-later wakeups that resume a specific conversation                 |

## Lifecycle

The desktop app spawns the daemon as a child process on launch and sends SIGTERM on quit. The daemon communicates over a local Unix socket.

```
Desktop app ←──→ Daemon (child process)
                    │
                    ├── Runtime DB (SQLite)
                    ├── Automation store
                    ├── Run logs
                    └── Companion API (HTTP/WebSocket)
```

If the daemon crashes or is killed, the desktop app restarts it automatically.

## Durable Agent Runs

Subagents and scheduled agent tasks run through the daemon's internal background agent runner. The daemon still spawns a child process for isolation, logs, cancellation, and replay, but that child imports the same server-side agent session stack used by live conversations instead of shelling out to the `pi` or `pa` CLI binaries.

## Daemon State API

| Endpoint      | Method | What it returns                          |
| ------------- | ------ | ---------------------------------------- |
| `/api/daemon` | GET    | Current daemon runtime status and uptime |

### State response

```json
{
  "running": true,
  "pid": 82341,
  "uptimeMs": 2845000
}
```

## Companion API

The daemon exposes an HTTP/WebSocket API for external clients. Configured in daemon config:

- **Host** — bind address (default: `127.0.0.1`)
- **Port** — listen port (default: auto-assigned)

The companion API serves the iOS app.

## State Storage

The daemon stores its state in `<state-root>/daemon/` by default. If `PERSONAL_AGENT_DAEMON_SOCKET_PATH` is set, daemon runtime files live beside that explicit socket path instead; this lets dev hosts isolate their runtime DB from the desktop app.

| Path         | Content                                         |
| ------------ | ----------------------------------------------- |
| `runtime.db` | SQLite database for runs, tasks, reminders      |
| `socket`     | Local Unix socket for desktop app communication |
| `logs/`      | Run output logs                                 |

On startup, the runtime DB is integrity-checked before schema setup. If SQLite reports corruption, the app tries to recover it with `sqlite3 .recover`, quarantines the original files under `.corrupt/`, and recreates a healthy DB if recovery is unavailable.

## Configuration

Daemon settings are part of the main config.json:

```json
{
  "daemon": {
    "companion": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 0
    }
  }
}
```

Most daemon settings are managed through the desktop Settings UI and do not require manual config file edits.
