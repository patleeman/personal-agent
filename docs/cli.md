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
   - `pa tui ...`
   - `pa <any pi args>`

In passthrough mode, `pa` resolves profile resources, prepares runtime state, and then launches `pi`.

## Important behavior

- `pa` (no args) shows CLI help.
- `pa` is a superset wrapper for Pi CLI usage: unknown top-level args are treated as Pi args.
  - Example: `pa -p "hello"`
- Global output controls:
  - `--plain` / `--no-color` disables rich styling
  - `doctor --json`, `daemon status --json`, and `memory status --json` emit machine-readable JSON

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
pa tui [pi args...]
pa profile [list|show|use]
pa doctor
pa gateway
pa gateway setup [telegram|discord]
pa gateway start [telegram|discord]
pa gateway service [install|status|uninstall|help] [telegram|discord]
pa daemon
pa daemon help
pa daemon [status|start|stop|restart|logs]
pa daemon status [--json]
pa daemon service [install|status|uninstall|help]
pa memory [list|query|search|head|open|status]
```

`pa daemon` now prints daemon command help. Use `pa daemon status` for runtime status.

## Memory commands

The memory system provides cross-session context through summaries and durable profile memory.

### Browse recent sessions

```bash
pa memory head [count]          # Latest markdown summaries (default: 5)
```

### Open specific session

```bash
pa memory open <sessionId>              # View summary markdown
```

### Search with qmd

```bash
pa memory query "authentication flow"   # Semantic search summaries
pa memory search "pattern"              # Full-text search
pa memory list                          # List all indexed files
```

### Check system status

```bash
pa memory status                        # Human-readable status
pa memory status --json                 # Machine-readable JSON
```

Status includes:
- Session coverage (summarized vs total)
- Index state (dirty, needs embedding)
- qmd collection stats
- Directory paths

## Cross-package command registration

`pa` keeps command parsing in `@personal-agent/cli`, while feature packages can register commands.

Current example:

- `@personal-agent/gateway` registers the `gateway` command
- CLI discovers it at startup and routes `pa gateway ...` to provider handlers (`telegram` / `discord`)

This keeps package boundaries clean: gateway logic stays in the gateway package, while command dispatch stays in CLI.

## How passthrough TUI works

When `pa` runs Pi (via `pa`, `pa tui`, or `pa <pi args>`), it:

1. resolves configured profile (`~/.config/personal-agent/config.json`)
2. resolves layers: shared -> selected profile -> optional local overlay
3. validates runtime state paths
4. bootstraps runtime directories
5. materializes merged runtime agent files
6. builds explicit Pi resource args (`--skill`, `-e`, `--prompt-template`, `--theme`)
7. injects default model/thinking from settings if missing
8. auto-installs extension dependencies when missing
9. launches `pi` with `PI_CODING_AGENT_DIR` pointing at runtime agent dir

## Extension auto-installation

Profiles can include Pi extensions with npm dependencies. When `pa tui` runs:

1. Discovers extensions from all profile layers
2. Checks for `package.json` in extension directories
3. Runs `npm install` if `node_modules` is missing
4. Continues with Pi launch

Extensions are loaded by Pi at startup. Use `/reload` in Pi TUI to reload extensions without restarting.

See `docs/extensions.md` for authoring guide.

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
pa tui
```

If `pa tui` launches TUI and `profile show` includes both skill dirs, layering is working.
