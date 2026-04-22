# Troubleshooting

Use this doc for the common local failures.

## Start here

```bash
pa doctor
pa status
pa daemon status
pa ui status
```

If runs or automations are involved, also check:

```bash
pa daemon logs
```

## `pa` or Pi will not start

Run:

```bash
npm install
npm run build
```

Then retry `pa doctor`.

## Web UI will not start

Check:

```bash
pa ui status
lsof -i tcp:3741
```

Common fixes:

- build artifacts are missing → `npm run build`
- another process already owns the port
- the managed web UI service needs `pa ui restart`

## Daemon is unhealthy

Check:

```bash
pa daemon status
pa daemon logs
```

If you need the persistent user service:

```bash
pa daemon service install
```

## Automations are not firing

Check all of these:

- daemon is running
- the automation is enabled
- the schedule is valid
- the automation has not already resolved if it is one-shot
- the daemon was not offline outside the catch-up window

Then inspect the automation detail page and owned run history in the web UI.

## Detached run failed or looks stuck

Use the owning conversation or automation detail first, then check daemon logs.

Use the built-in `run` tool to rerun, follow up, or cancel. Do not reach for an old `pa runs` workflow.

## Vault root looks wrong

Check in this order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. `<config-root>/config.json` → `knowledgeBaseRepoUrl`
3. `<config-root>/config.json` → `vaultRoot`

Remember: configured `knowledgeBaseRepoUrl` switches the effective root to `<state-root>/knowledge-base/repo` unless the env var overrides it.

## Pairing code or remote browser access fails

Remember the current rules:

- pairing codes are short-lived
- paired browser sessions expire after inactivity
- `pa ui pairing-code` requires the local web admin surface to be reachable

Generate a fresh code if needed.

## Desktop shell will not launch

Check the desktop logs:

```text
<state-root>/desktop/logs/
```

Also check whether another process already owns the local web or daemon resources.

The desktop shell may own the daemon directly; a separately managed daemon can still interfere depending on startup state.

If the logs mention `better-sqlite3` and `NODE_MODULE_VERSION` mismatch, the Electron dev shell was trying to load a native SQLite binary built for a different runtime.

`packages/desktop/scripts/launch-dev-app.mjs` now prepares an Electron-specific native module cache under:

```text
<repo-root>/dist/dev-desktop/native-modules/
```

If it still gets wedged, remove that folder and relaunch `npm run desktop:dev` so the Electron-native copy gets rebuilt cleanly.

## MCP auth problems

Run:

```bash
pa mcp list --probe
pa mcp info <server>
pa mcp auth <server>
```

Common causes:

- wrong `mcp_servers.json`
- stale auth state
- missing remote OAuth metadata

## Useful log locations

```text
<state-root>/daemon/logs/daemon.log
<state-root>/web/logs/web.log
<state-root>/desktop/logs/main.log
<state-root>/desktop/logs/daemon.log
```

## Related docs

- [Getting Started](./getting-started.md)
- [Configuration](./configuration.md)
- [Daemon](./daemon.md)
- [Web UI Guide](./web-ui.md)
