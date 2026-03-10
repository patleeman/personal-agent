# CLI Guide (`pa`)

This document explains how `pa` works and what each command is responsible for.

## Command model

`pa` has two modes:

1. **Management commands** handled by personal-agent:
   - `pa profile ...`
   - `pa doctor`
   - `pa daemon ...`
   - `pa tasks ...`
   - `pa memory ...`
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
- `pa memory list --json`
- `pa memory find --json`
- `pa memory show <id> --json`
- `pa memory new <id> --json`
- `pa memory lint --json`
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
pa memory [list|find|show|new|lint]
pa tmux [list|inspect|logs|stop|send|run|clean|help]
pa restart
pa update [--repo-only]
pa gateway ...
```

Notes:

- Interactive `pa tui` runs Pi inside a PA-managed tmux workspace with a repo-managed tmux config when launched from a normal terminal.
- If that workspace is already attached in another terminal, `pa tui` creates a grouped tmux session with a fresh Pi window so the two terminals do not mirror the same active window.
- If `pa tui` is launched from inside an existing tmux session, it skips workspace attach and runs Pi directly in the current pane instead of nesting tmux.
- Workspace shortcuts are exposed via a `Ctrl+Space` tmux shortcut mode with a quick hint overlay, including `?` for the help popup and `t` for managed task status.
- Non-interactive Pi modes (`-p`, `--mode json`, `--mode rpc`, `--export`, etc.) still run Pi directly without the tmux workspace wrapper.
- `pa daemon` prints daemon command help.
- `pa tasks` prints detailed tasks command help.
- `pa memory` prints memory-doc command help.
- `pa tmux` manages only agent-tagged tmux sessions (`@pa_agent_session=1`).
- `pa update` runs `git pull --rebase --autostash`, installs repo dependencies (`npm install`), syncs `@mariozechner/pi-coding-agent` to `@latest` in the repo + gateway workspace, verifies repo-local Pi, rebuilds personal-agent packages (`npm run build`), then restarts background services.
- `pa update --repo-only` skips dependency refresh but still rebuilds personal-agent packages and restarts background services.

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

## Memory doc commands

```bash
pa memory list [--profile <name>] [--json]
pa memory find [--profile <name>] [--tag <tag>] [--type <type>] [--status <status>] [--text <query>] [--json]
pa memory show <id> [--profile <name>] [--json]
pa memory new <id> --title <title> --summary <summary> --tags <tag1,tag2> [--type <type>] [--status <status>] [--profile <name>] [--force] [--json]
pa memory lint [--profile <name>] [--json]
```

Memory commands operate on profile-local `agent/memory/*.md` docs with YAML frontmatter.
`pa memory new` creates a frontmatter-correct starter doc.

---

## Managed tmux commands

```bash
pa tmux list [--json]
pa tmux inspect <session> [--json]
pa tmux logs <session> [--tail <n>]
pa tmux stop <session>
pa tmux send <session> <command>
pa tmux run <task-slug> [--cwd <path>] [--placement <auto|background|pane>] [--notify-on-complete] [--notify-context <value>] [--] <command...>
pa tmux clean [--dry-run] [--json]
```

`pa tmux` intentionally ignores non-agent sessions and only operates on sessions tagged with `@pa_agent_session=1`.
`pa tmux run --placement auto` opens a live log pane when invoked from a `pa tui` workspace and falls back to background mode elsewhere.
`pa tmux clean` removes stale managed-session log files after sessions have completed.

### `pa tui` workspace shortcuts

Inside the managed workspace, press `Ctrl+Space`, then press:

- `?` — shortcut helper popup
- `t` — managed tmux task popup
- `-` / `|` — split below / split right
- `h` `j` `k` `l` — move between panes
- `[` / `]` — previous / next window
- `1` … `9` — switch to window 1 … 9
- `H` `J` `K` `L` — resize panes (repeatable for ~1s after the first press)
- `Tab` — jump to previous pane
- `z` — zoom active pane
- `w` — close pane with confirmation
- `n` — new tmux window in current directory
- `r` — reload PA tmux config

---

## Restart vs update

## `pa restart`

- restarts daemon process
- restarts managed gateway services if installed
- prints summary of restarted/skipped services

## `pa update`

- pulls latest repo changes (`git pull --rebase --autostash`)
- runs `npm install` in the personal-agent repo (refreshes repo-local dependencies)
- runs `npm install @mariozechner/pi-coding-agent@latest` in both repo root and `@personal-agent/gateway` workspace
- verifies repo-local Pi is runnable
- rebuilds personal-agent packages (`npm run build`)
- restarts daemon and managed gateways

Use `--repo-only` when you want to skip dependency refresh (build + restart still run).

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
10. for interactive runs, launches or attaches to a PA-managed tmux workspace and starts Pi inside it
11. for non-interactive runs, launches Pi directly with `PI_CODING_AGENT_DIR` pointed at runtime agent dir

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
pa memory list
pa memory new quick-note --title "Quick Note" --summary "What this doc tracks" --tags notes
pa tmux list
pa tui
```

---

## Related docs

- [Configuration](./configuration.md)
- [Profile Schema](./profile-schema.md)
- [Gateway Guide](./gateway.md)
- [Troubleshooting](./troubleshooting.md)
