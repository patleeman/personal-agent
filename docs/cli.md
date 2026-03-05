# CLI Guide (`pa`)

This document explains how `pa` works and what each command is responsible for.

## Command model

`pa` has two modes:

1. **Management commands** handled by personal-agent:
   - `pa profile ...`
   - `pa doctor`
   - `pa daemon ...`
   - `pa tasks ...`
   - `pa tmux ...`
   - `pa gateway ...`
   - `pa restart`
   - `pa update`

2. **Pi passthrough mode**:
   - `pa tui ...`
   - `pa <any pi args>`

In passthrough mode, `pa` resolves profile resources, prepares runtime state, and launches Pi with explicit resource flags.

---

## Important behavior

- `pa` (no args) shows CLI help.
- Unknown top-level args are treated as Pi args.
  - Example: `pa -p "hello"`
- Global output controls:
  - `--plain` / `--no-color`
  - env: `PERSONAL_AGENT_PLAIN_OUTPUT=1` or `NO_COLOR=1`

Machine-readable output:

- `pa doctor --json`
- `pa daemon status --json`
- `pa tasks list --json`
- `pa tasks show <id> --json`
- `pa tasks validate --json`
- `pa tmux list --json`
- `pa tmux inspect <session> --json`
- `pa tmux clean --json`

---

## Pi binary resolution

When launching Pi, `pa` checks in this order:

1. repo-local Pi SDK CLI (`node_modules/@mariozechner/pi-coding-agent/dist/cli.js`)
2. global `pi` on PATH

If neither is runnable, `pa` exits with a setup error.

---

## Profile selection

Set default once:

```bash
pa profile use datadog
```

One-off override for a run:

```bash
pa tui --profile datadog
# or passthrough mode
pa --profile datadog -p "hello"
```

Inspect:

```bash
pa profile list
pa profile show
pa profile show datadog
```

---

## Core commands

```bash
pa
pa tui [--profile <name>] [pi args...]
pa profile [list|show|use]
pa doctor [--json]
pa daemon [status|start|stop|restart|logs|service|help]
pa daemon status [--json]
pa daemon service [install|status|uninstall|help]
pa tasks [list|show|validate|logs]
pa tmux [list|inspect|logs|stop|send|run|clean|help]
pa restart
pa update [--repo-only]
pa gateway ...
```

Notes:

- `pa daemon` prints daemon command help.
- `pa tasks` prints detailed tasks command help.
- `pa tmux` manages only agent-tagged tmux sessions (`@pa_agent_session=1`).
- `pa update` runs `git pull --ff-only`, installs repo dependencies (`npm install`), verifies repo-local Pi, then restarts background services.
- `pa update --repo-only` skips dependency refresh.

---

## Scheduled task commands

```bash
pa tasks list [--json] [--status <all|running|active|completed|disabled|pending|error>]
pa tasks show <id> [--json]
pa tasks validate [--all|file] [--json]
pa tasks logs <id> [--tail <n>]
```

See [Scheduled Tasks](./tasks.md) for schema and runtime semantics.

---

## Managed tmux commands

```bash
pa tmux list [--json]
pa tmux inspect <session> [--json]
pa tmux logs <session> [--tail <n>]
pa tmux stop <session>
pa tmux send <session> <command>
pa tmux run <task-slug> [--cwd <path>] [--] <command...>
pa tmux clean [--dry-run] [--json]
```

`pa tmux` intentionally ignores non-agent sessions and only operates on sessions tagged with `@pa_agent_session=1`.
`pa tmux clean` removes stale managed-session log files after sessions have completed.

---

## Restart vs update

## `pa restart`

- restarts daemon process
- restarts managed gateway services if installed
- prints summary of restarted/skipped services

## `pa update`

- pulls latest repo changes (`git pull --ff-only`)
- runs `npm install` in the personal-agent repo (refreshes repo-local dependencies, including Pi)
- verifies repo-local Pi is runnable
- restarts daemon and managed gateways

Use `--repo-only` when you want to skip dependency refresh.

---

## How passthrough launch works

When `pa` runs Pi (`pa`, `pa tui`, or `pa <pi args>`), it:

1. resolves profile from `--profile` or default profile config
2. resolves layers (`shared` → selected profile → optional local overlay)
3. validates runtime state paths are outside repo
4. bootstraps runtime state directories
5. materializes merged runtime agent files
6. auto-installs extension dependencies when missing
7. builds explicit Pi resource args (`--skill`, `-e`, `--prompt-template`, `--theme`)
8. applies optional system dark/light theme mapping (`themeDark`/`themeLight`)
9. injects default model/thinking from settings if omitted
10. launches Pi with `PI_CODING_AGENT_DIR` pointed at runtime agent dir

---

## Auth behavior

When running via `pa`, auth is stored in personal-agent runtime state:

- runtime auth: `~/.local/state/personal-agent/pi-agent/auth.json`
- legacy auth: `~/.pi/agent/auth.json`

If runtime auth is missing and legacy auth exists, `pa` seeds runtime auth once.
There is no sync-back to legacy auth.

---

## Datadog layering reminder

For `datadog` profile:

1. `profiles/shared/agent/skills`
2. `profiles/datadog/agent/skills`
3. optional local overlay skill dirs

---

## Quick verification

```bash
pa profile use datadog
pa profile show datadog
pa doctor
pa daemon status
pa tasks list
pa tmux list
pa tui
```

---

## Related docs

- [Configuration](./configuration.md)
- [Profile Schema](./profile-schema.md)
- [Gateway Guide](./gateway.md)
- [Troubleshooting](./troubleshooting.md)
