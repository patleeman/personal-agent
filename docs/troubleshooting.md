# Troubleshooting

This page covers the most common user-facing failures in `personal-agent`.

## Start here

Run these first:

```bash
pa doctor
pa daemon status
pa profile show
```

If scheduled tasks are involved:

```bash
pa tasks list
pa tasks validate --all
```

## `pa` cannot find Pi

Typical message:

- `Unable to find a runnable pi binary`

Fix:

```bash
npm install
npm run build
```

Optional global fallback:

```bash
npm install -g @mariozechner/pi-coding-agent
```

## Unknown or missing profile

Typical message:

- `Unknown profile: <name>`

Check available profiles:

```bash
pa profile list
```

Set a valid default:

```bash
pa profile use assistant
```

## Runtime state path points inside the repo

`personal-agent` expects mutable runtime state outside the git repo.

Fix by resetting or overriding the state root:

```bash
export PERSONAL_AGENT_STATE_ROOT="$HOME/.local/state/personal-agent"
```

## Web UI does not start

Common reason:

- the web app build is missing

Build it:

```bash
npm run build
```

Then start again:

```bash
pa ui --open
```

## Daemon is not running

Typical symptom:

- scheduled tasks do not run
- background automation is missing
- warnings mention disabled background events

Fix:

```bash
pa daemon start
```

Recommended long-term fix:

```bash
pa daemon service install
```

Check status:

```bash
pa daemon status
```

## Sync does not start (especially on another device)

Typical symptoms in the Sync page:

- `Sync module is disabled in daemon configuration`
- `Daemon does not report the sync module`
- `Sync repo is not initialized`

Recommended fix sequence:

```bash
git pull
pa restart --rebuild
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync run
pa sync status
```

Use `--fresh` only for first machine/new remote initialization.

If needed, inspect daemon details:

```bash
pa daemon status --json
```

## Scheduled task is missing

Check that the file:

- is in the configured task directory
- ends with `.task.md`
- has valid YAML frontmatter
- has a non-empty Markdown body

Validate everything:

```bash
pa tasks validate --all
```

## Scheduled task was skipped

Common reasons:

- the previous run was still active
- a one-time `at` task was due while the daemon was offline

Inspect:

```bash
pa tasks show <id>
```

Look at last status, last error, and one-time resolution fields.

## No task logs found

Either:

- the task has never run
- logs were reaped
- the task id is wrong

Check:

```bash
pa tasks show <id>
pa tasks list --status running
```

## Inbox looks empty or stale

Remember:

- the current inbox is activity-backed
- not every conversation reply creates an inbox item
- the inbox mainly reflects asynchronous events

Refresh or inspect via CLI:

```bash
pa inbox list
pa inbox list --unread
```

If you expected a task result, verify the task actually ran.

## Memory packages fail to parse

Run:

```bash
pa memory lint
```

Common problems:

- missing YAML frontmatter
- missing required keys
- invalid `updated` date format
- duplicate ids
- empty body

## `pa update` fails

`pa update` does several things:

- pulls latest repo changes
- refreshes dependencies
- rebuilds packages
- restarts background services

If dependency refresh is the problem, try:

```bash
pa update --repo-only
```

## Need logs and machine-readable state

Useful commands:

```bash
pa doctor --json
pa daemon status --json
pa tasks list --json
pa inbox list --json
pa memory list --json
```

Useful log locations:

- daemon: `~/.local/state/personal-agent/daemon/logs/daemon.log`
- web UI: `~/.local/state/personal-agent/web/logs/web.log`

## Still stuck?

Collect:

```bash
pa doctor --json
pa daemon status --json
pa profile show
pa tasks list --json
```

and include relevant recent logs.
