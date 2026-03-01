# CLI Guide (`pa`)

This document explains how `pa` works.

## Command model

`pa` has two modes:

1. **Management commands** (handled by `pa`):
   - `pa profile ...`
   - `pa doctor`
   - `pa daemon ...`
   - `pa gateway ...` (registered by `@personal-agent/gateway`)

2. **Pi passthrough mode**:
   - `pa run ...`
   - `pa <any pi args>`

In passthrough mode, `pa` resolves profile resources, prepares runtime state, and then launches `pi`.

## Important behavior

- `pa` (no args) shows CLI help.
- `pa` is a superset wrapper for Pi CLI usage: unknown top-level args are treated as Pi args.
  - Example: `pa -p "hello"`

## Profile selection

Profile is configured once and reused.

Set it with:

```bash
pa profile use datadog
```

Inspect current default and available profiles:

```bash
pa profile list
```

Show resolved profile details:

```bash
pa profile show
pa profile show datadog
```

## Core commands

```bash
pa
pa run [pi args...]
pa profile [list|show|use]
pa doctor
pa gateway
pa gateway setup [telegram|discord]
pa gateway start [telegram|discord]
pa daemon [status|start|stop|restart|logs]
pa daemon status [--json]
```

## Cross-package command registration

`pa` keeps command parsing in `@personal-agent/cli`, while feature packages can register commands.

Current example:

- `@personal-agent/gateway` registers the `gateway` command
- CLI discovers it at startup and routes `pa gateway ...` to provider handlers (`telegram` / `discord`)

This keeps package boundaries clean: gateway logic stays in the gateway package, while command dispatch stays in CLI.

## How passthrough run works

When `pa` runs Pi (via `pa`, `pa run`, or `pa <pi args>`), it:

1. resolves configured profile (`~/.config/personal-agent/config.json`)
2. resolves layers: shared -> selected profile -> optional local overlay
3. validates runtime state paths
4. bootstraps runtime directories
5. materializes merged runtime agent files
6. builds explicit Pi resource args (`--skill`, `-e`, `--prompt-template`, `--theme`)
7. injects default model/thinking from settings if missing
8. auto-installs extension dependencies when missing
9. launches `pi` with `PI_CODING_AGENT_DIR` pointing at runtime agent dir

## Auth behavior

When running via `pa`, Pi auth is stored in the personal-agent runtime dir, not legacy Pi config:

- runtime auth: `~/.local/state/personal-agent/pi-agent/auth.json` (default)
- legacy auth: `~/.pi/agent/auth.json`

On first run, `pa` may seed runtime auth from legacy auth **only if runtime auth is missing**.
There is no sync-back to legacy auth.

## Datadog layering

For `datadog`, skills are layered in order:

1. `profiles/shared/agent/skills`
2. `profiles/datadog/agent/skills`
3. optional local overlay skills

So Datadog skills are appended on top of shared skills.

## Quick verification

```bash
pa profile use datadog
pa profile show datadog
pa doctor
pa gateway help
pa run
```

If `pa run` launches TUI and `profile show` includes both skill dirs, layering is working.
