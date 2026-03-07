# Troubleshooting

This page covers common `pa` failures and quick fixes.

## First-line diagnostics

Run these first:

```bash
pa doctor
pa doctor --json
pa daemon status
pa daemon status --json
pa profile show
```

For scheduled tasks:

```bash
pa tasks list
pa tasks validate --all
```

---

## CLI and startup issues

## "Unable to find a runnable pi binary"

`pa` looks for Pi in this order:

1. repo-local `node_modules/@mariozechner/pi-coding-agent/dist/cli.js`
2. global `pi` on PATH

Fixes:

```bash
# From repo root
npm install
npm run build

# Optional global fallback
npm install -g @mariozechner/pi-coding-agent
```

## "Unknown profile: <name>" or "Profile not found"

Check profiles:

```bash
pa profile list
```

Set a valid default:

```bash
pa profile use shared
# or
pa profile use datadog
```

## Runtime state path errors (inside repo)

`pa` requires mutable state outside the git repo.

Fix by setting a safe state root:

```bash
export PERSONAL_AGENT_STATE_ROOT="$HOME/.local/state/personal-agent"
```

(Or unset custom overrides that pointed inside repo.)

---

## Daemon issues

## "daemon is not running; background events are disabled"

Start daemon manually:

```bash
pa daemon start
```

Install managed service (recommended for always-on behavior):

```bash
pa daemon service install
```

## Service manager errors (`launchctl`/`systemctl` missing)

Managed services only support:

- macOS (`launchd`)
- Linux (`systemd --user`)

If unavailable, run daemon/gateway in foreground mode instead.

## Need to suppress daemon integration temporarily

Set:

```bash
export PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1
```

This disables daemon event emission and gateway daemon auto-start.

---

## Gateway issues

## Missing token/allowlist errors

Examples:

- `TELEGRAM_BOT_TOKEN is required`
- `PERSONAL_AGENT_TELEGRAM_ALLOWLIST is required`
- `DISCORD_BOT_TOKEN is required`
- `PERSONAL_AGENT_DISCORD_ALLOWLIST is required`

Fix via setup:

```bash
pa gateway setup telegram
pa gateway setup discord
```

Or provide environment variables directly.

## `op://...` secrets fail to resolve

Check:

- `op` CLI is installed and authenticated
- `OP_SERVICE_ACCOUNT_TOKEN` is set if using service-account auth
- Optional overrides are correct:
  - `PERSONAL_AGENT_OP_BIN`
  - `PERSONAL_AGENT_OP_READ_TIMEOUT_MS`

## Gateway service installs but appears inactive

Inspect status:

```bash
pa gateway service status telegram
pa gateway service status discord
```

Then inspect logs:

- macOS: `~/.local/state/personal-agent/gateway/logs/<provider>.log`
- Linux: `journalctl --user -u personal-agent-gateway-<provider>.service -f`

---

## Scheduled task issues

## "No valid task files found"

Ensure files:

- are in configured task dir (`pa daemon status` shows it)
- end with `.task.md`
- contain valid YAML frontmatter + non-empty body

Validate all files:

```bash
pa tasks validate --all
```

## Task parse errors

Use:

```bash
pa tasks list
pa tasks validate --all
```

to get file-level parse failures.

## Task skipped unexpectedly

Common reasons:

- previous run still active (overlap skip)
- one-time `at` task was due while daemon was offline

Inspect runtime state:

```bash
pa tasks show <id>
```

Look at `Last error`, `Last status`, and one-time fields.

## "No logs found for task"

The task may never have run yet, or state/logs may have been reaped.

Check:

```bash
pa tasks show <id>
pa tasks list --status running
```

---

## Update/restart issues

## `pa update` fails during repo dependency install

`pa update` executes:

- `git pull --rebase --autostash`
- `npm install` in the personal-agent repo
- `npm install @mariozechner/pi-coding-agent@latest` in repo root + `@personal-agent/gateway` workspace
- background service restart

If you need to skip dependency refresh temporarily, use:

```bash
pa update --repo-only
```

## `pa restart` skips gateway services

This is expected when gateway managed services are not installed.

Install if needed:

```bash
pa gateway service install telegram
pa gateway service install discord
```

---

## Still stuck?

Capture these for debugging:

```bash
pa doctor --json
pa daemon status --json
pa profile show
pa tasks list --json
```

and include recent daemon/gateway logs.
