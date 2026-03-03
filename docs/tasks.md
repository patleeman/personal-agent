# Scheduled Tasks

`pa` scheduled tasks let `personal-agentd` run Pi prompts on cron or one-time schedules.

## Where tasks live

Default directory:

- `~/.config/personal-agent/tasks`

Only files ending in **`.task.md`** are auto-discovered.

You can change the directory in daemon config:

- `~/.config/personal-agent/daemon.json` → `modules.tasks.taskDir`

---

## Task file format

A task file is Markdown with YAML frontmatter.

```md
---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
model: "openai-codex/gpt-5.3-codex"
cwd: "~/agent-workspace"
timeoutSeconds: 1800
output:
  when: success
  targets:
    - gateway: telegram
      chatId: "123456789"
---
Summarize yesterday's work and top priorities for today.
```

Body text is the prompt sent to Pi (`-p <prompt>`).

---

## Frontmatter reference

| Key | Required | Default | Notes |
|---|---|---|---|
| `id` | no | derived from filename | Must match `[a-zA-Z0-9][a-zA-Z0-9-_]*` |
| `enabled` | no | `true` | Boolean |
| `cron` | yes* | — | 5-field cron expression |
| `at` | yes* | — | One-time timestamp parseable by `Date.parse` |
| `profile` | no | `shared` | Profile to run task under |
| `provider` | no | — | Optional when paired with `model` |
| `model` | no | — | If `provider` is set, this is model id; otherwise treated as full model ref |
| `cwd` | no | current process cwd | `~` is expanded |
| `timeoutSeconds` | no | daemon `defaultTimeoutSeconds` (default `1800`) | Positive integer |
| `output` | no | — | Optional gateway notification routing |

\* Exactly one of `cron` or `at` is required.

### Model field behavior

- `provider` + `model` → combined into `provider/model`
- `model` only → used as-is (for example `openai-codex/gpt-5.3-codex`)
- `provider` without `model` → validation error

---

## Schedule semantics

## Cron

- Must have 5 fields: minute hour day-of-month month day-of-week
- Supports wildcards (`*`), lists (`,`), ranges (`-`), and steps (`/`)
- Day-of-week accepts `0-6`, and `7` is normalized to Sunday (`0`)
- Evaluated in daemon local time

## One-time (`at`)

- Parsed with JavaScript `Date.parse`
- If daemon was offline at scheduled time, task is marked skipped with reason
- After one-time task resolves, it does not run again

---

## Output routing (`output`)

`output` lets task results/failures send messages to gateway chats/channels.

```yaml
output:
  when: success   # success | failure | always
  targets:
    - gateway: telegram
      chatId: "123456789"
    - gateway: discord
      channelId: "987654321"
```

Also supported:

- `chatIds: ["..."]` for Telegram
- `channelIds: ["..."]` for Discord

`chatId` and `chatIds` (or `channelId` and `channelIds`) are mutually exclusive per target.

---

## Runtime behavior

- Tick interval defaults to 30s (`tickIntervalSeconds`)
- Cron tasks run at most once per matching minute
- Overlap is prevented: if previous run is active, the next run is skipped
- Retries happen up to `maxRetries` (default `3`)
- Each attempt writes a run log under daemon `task-runs`
- Task output captured for notifications is truncated to protect message size

One-time task lifecycle:

- `success` → status can appear as `completed` in CLI
- `failed` or `skipped` → visible via runtime status/error fields
- Completed one-time task files + run logs are reaped after `reapAfterDays` (default `7`)

---

## CLI commands

### List tasks

```bash
pa tasks list
pa tasks list --status active
pa tasks list --json --status completed
```

Status filter values:

- `all`
- `running`
- `active`
- `completed`
- `disabled`
- `pending`
- `error`

Status mapping notes:

- `completed` is currently used for successful one-time tasks
- `pending` maps to last runtime status `skipped`
- `error` maps to last runtime status `failed`

### Show one task

```bash
pa tasks show <id>
pa tasks show <id> --json
```

### Validate task files

```bash
pa tasks validate            # validates all discovered task files
pa tasks validate --all
pa tasks validate /path/to/file.task.md
pa tasks validate --json
```

### Show logs for latest run

```bash
pa tasks logs <id>
pa tasks logs <id> --tail 120
```

---

## Paths and state

From daemon state root (`~/.local/state/personal-agent/daemon` by default):

- task state: `task-state.json`
- run logs: `task-runs/<task-id>/...`

Useful inspection command:

```bash
pa daemon status --json
```

---

## Validation failures you will commonly see

- Missing or malformed frontmatter
- Both `cron` and `at` set (or neither set)
- Invalid cron field values
- Empty Markdown body prompt
- Invalid `output.targets` schema

Use:

```bash
pa tasks validate --all
```

for a quick parse pass with precise file-level errors.
