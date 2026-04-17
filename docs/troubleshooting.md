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

If automations or runs are involved, start from the owning web UI surface and the daemon:

```bash
pa daemon status
pa daemon logs
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

## `npm` or Homebrew tools are missing inside agent shells

Recent runtimes hydrate their own `PATH` from your login shell at startup so GUI and launchd launches can still find Homebrew-installed tools.

If you are still on an older running daemon or web service after updating, restart them:

```bash
pa daemon restart
pa ui restart
```

If the path is still wrong after that, reinstall the managed service so launchd picks up the refreshed environment.

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
pa daemon logs
```

Then inspect the automation detail page and its owned run history, or validate legacy task files with the `scheduled_task` tool.

Common causes:

- daemon is off
- invalid task frontmatter
- task file is in the wrong directory
- one-time task already completed
- task run is failing and needs log inspection

## Durable run is stuck or failed

Inspect the owning conversation or automation detail, then check daemon logs if needed:

```bash
pa daemon logs
```

If you need to act on the run, use the built-in `run` tool rather than a CLI subcommand.

For interrupted conversations in the web UI:

- if the last turn is recoverable but no longer active, the conversation page should show a recovery strip above the composer instead of silently looking live
- startup recovery now only auto-resumes conversations that still have a real pending turn to replay; interrupted sessions without replayable work stay non-live so the explicit resume affordance remains visible

## Pairing code or remote browser access fails

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

The desktop shell is a menu bar app on macOS. When no window is open, look for the status item in the menu bar; the Dock icon only appears while a desktop window is visible.

The local desktop backend intentionally refuses to start if:

- port `3741` is already in use

If a separate daemon is already healthy, stable desktop builds now refuse to attach to it instead of silently reusing it.

Stop or uninstall the external daemon, then relaunch the desktop app:

```bash
pa daemon stop
pa daemon service uninstall
```

Testing/dev desktop launches can still attach to an already-running external daemon for compatibility. In that mode, quitting the desktop app does **not** stop the external daemon.

If startup fails, the menu bar item stays alive and offers **Retry Personal Agent** plus **Open Desktop Logs**.

Recent desktop builds also try to surface the failure inside the main window:

- startup/bootstrap failures open a dedicated error page in Electron with the error message and a shortcut to the desktop logs
- renderer recoveries inside the normal app shell keep the **Conversation unavailable** card, but now include the thrown error message in an **Error details** section

Desktop logs live under:

```text
~/.local/state/personal-agent/desktop/logs/
```

If a macOS dev launch opens a white window or spinner and the Electron helpers crash with `icudtl.dat not found in bundle`, the generated dev app bundle is usually stale or was copied incorrectly. Remove `dist/dev-desktop/` and relaunch so the desktop script rebuilds the app bundle with the expected framework links intact.

## SSH remote desktop host will not connect

Check:

- `ssh` works manually to the target host without password prompts in the desktop context
- the remote machine is macOS or Linux on `x64` or `arm64`
- the remote user can write to `~/.cache/personal-agent/ssh-runtime/`
- the desktop machine can download the matching Pi GitHub release asset locally
- the remote helper and Pi binaries were copied successfully to the remote cache
- the remote cwd you selected actually exists on the remote machine

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
```

## Related docs

- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)
- [Daemon and Background Automation](./daemon.md)
- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
