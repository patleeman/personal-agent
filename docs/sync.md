# Sync Guide (`pa sync` + Web UI Sync tab)

`personal-agent` supports git-backed cross-machine sync for durable state.

Use this when you want profiles, memory, tasks, projects, and session state to follow you across devices.

## What sync does

`pa sync setup` configures the daemon sync module and prepares a managed git repo under your state root (default: `~/.local/state/personal-agent/sync`).

After setup, the daemon periodically runs git sync in the background and the Web UI Sync tab shows health/status.

## What gets synced

The managed sync repo tracks these roots:

- `profiles/**`
- `pi-agent/**`
- `config/**` (setup seeds `config/config.json`)

Machine-local runtime files are kept outside the sync repo under `~/.local/state/personal-agent/pi-agent-runtime/**`.
That includes auth, settings, models, generated `AGENTS.md` / `SYSTEM.md` / `APPEND_SYSTEM.md`, `bin/**`, and the session index.

`config/daemon.json`, `config/gateway.json`, and `config/web.json` remain machine-local by default.

## First-time setup (first machine)

Use **Fresh** mode when initializing from your local machine into a new/empty remote:

```bash
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --fresh
```

You can do the same from the Web UI **Sync** tab by entering the repo URL and choosing **Fresh (new remote)**.

## Setup on another machine

Use **Bootstrap** mode when the remote already has sync history:

```bash
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
```

In the Web UI Sync tab, choose **Bootstrap (existing remote)**.

Why: bootstrap fetches and merges existing remote history. Fresh mode is for creating the initial remote snapshot.

## Day-to-day operations

Manual checks:

```bash
pa sync status
pa sync run
```

Web UI Sync tab lets you:

- run setup (repo URL, branch, mode, optional repo dir)
- run sync now
- inspect last success/run/commit
- inspect conflict/error resolver status
- review recent sync log lines

## Common warnings and fixes

### `Sync module is disabled`

Run setup again (CLI or Sync tab). Setup enables the daemon sync module.

### `Daemon does not report the sync module`

You are usually running an older daemon build. Restart after upgrading:

```bash
pa restart --rebuild
```

(or restart daemon service directly).

### `Sync repo is not initialized`

Run setup with your repo URL (`fresh` on first machine, `bootstrap` on additional machines).

## Quick recovery sequence for a new/updated machine

```bash
git pull
pa restart --rebuild
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync run
pa sync status
```

## Related docs

- [Web UI Guide](./web-ui.md)
- [Command-Line Guide](./command-line.md)
- [Configuration](./configuration.md)
- [Daemon and Background Automation](./daemon.md)
- [Troubleshooting](./troubleshooting.md)
