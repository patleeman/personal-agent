# Troubleshooting

This page covers the most common failures in `personal-agent`.

## Start here

Run these first:

```bash
pa doctor
pa status
pa daemon status
pa ui status
```

If tasks or runs are involved:

```bash
pa tasks list
pa tasks validate --all
pa runs list
```

## `pa` cannot find Pi

Typical fix:

```bash
npm install
npm run build
```

Optional global fallback:

```bash
npm install -g @mariozechner/pi-coding-agent
```

## Web UI will not start

Check whether the build exists and whether the port is already occupied:

```bash
pa ui status
lsof -i tcp:3741
```

Useful fixes:

- run `npm run build`
- stop the process already using the port
- use `pa ui foreground --port <port>` for a one-off override

## Daemon is not running

Inspect status and logs:

```bash
pa daemon status
pa daemon logs
```

If you want the background service installed persistently:

```bash
pa daemon service install
```

## Scheduled tasks are not firing

Check all of these:

```bash
pa daemon status
pa tasks validate --all
pa tasks list --status error
pa tasks show <id>
pa tasks logs <id>
```

Common causes:

- daemon is off
- invalid task frontmatter
- task file is in the wrong directory
- one-time task already completed
- task run is failing and needs log inspection

## Durable run is stuck or failed

Inspect the run directly:

```bash
pa runs show <id>
pa runs logs <id> --tail 200
```

If appropriate:

- `pa runs rerun <id>`
- `pa runs follow-up <id> --prompt "..."`
- `pa runs cancel <id>`

## Pairing code or companion access fails

Remember the current rules:

- pairing codes expire after 10 minutes
- paired sessions expire after 30 days of inactivity unless refreshed by active use
- `pa ui pairing-code` needs the local web UI/admin surface reachable

If needed, generate a new code and pair again.

## Tailscale Serve is not exposing the UI

Check the current web UI status and preference first:

```bash
pa ui status
```

If you are using a managed service, restart it after changing settings:

```bash
pa ui restart
```

## Vault path looks wrong

Inspect the effective machine config:

- `~/.local/state/personal-agent/config/config.json`
- `PERSONAL_AGENT_VAULT_ROOT` if set in your shell/service environment

The environment variable wins over machine config.

## Electron desktop shell will not launch

The local desktop backend intentionally refuses to start if:

- another daemon is already running outside the desktop app
- port `3741` is already in use

Stop the external daemon/web UI first, then launch the desktop app again.

Desktop logs live under:

```text
~/.local/state/personal-agent/desktop/logs/
```

## SSH remote desktop host will not connect

Check:

- `ssh` works manually to the target host
- the remote repo root is correct
- the remote machine has `pa` available
- the remote web UI port is reachable through the tunnel

The desktop SSH controller defaults the remote repo root to `~/workingdir/personal-agent` and the remote web UI port to `3741` unless you override them.

## MCP auth problems

Useful checks:

```bash
pa mcp list --probe
pa mcp info <server>
pa mcp auth <server>
```

Common causes:

- wrong `mcp_servers.json`
- missing OAuth client metadata for remote MCP servers
- stale machine-local auth state

## Useful log locations

By default:

```text
~/.local/state/personal-agent/daemon/logs/daemon.log
~/.local/state/personal-agent/web/logs/web.log
~/.local/state/personal-agent/desktop/logs/main.log
~/.local/state/personal-agent/desktop/logs/daemon.log
~/.local/state/personal-agent/desktop/logs/web-ui.log
```

## Related docs

- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)
- [Daemon and Background Automation](./daemon.md)
- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
