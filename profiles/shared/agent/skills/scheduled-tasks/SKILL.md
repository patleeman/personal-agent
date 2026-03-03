---
name: scheduled-tasks
description: Create, update, or debug personal-agent daemon scheduled tasks (`*.task.md`). Use when users ask for recurring/one-time automation, cron schedules, `at` schedules, or task execution/runtime settings.
---

# Scheduled Tasks

Use this skill when the user wants the daemon to run prompts automatically.

## Canonical paths

- Task definitions (machine-local): `~/.config/personal-agent/tasks/*.task.md`
- Runtime state: `~/.local/state/personal-agent/daemon/task-state.json`
- Run logs: `~/.local/state/personal-agent/daemon/task-runs/<task-id>/...`
- Starter template in repo: `docs/examples/scheduled-task.task.md`

## Task file contract

A task is markdown with YAML frontmatter.

- Must include exactly one schedule field: `cron` **or** `at`
- Markdown body is the prompt passed to `pi -p`
- Frontmatter supports full YAML objects/lists (nested output routing is supported)

### Supported frontmatter keys

- `id` (optional; defaults from filename)
- `enabled` (optional; default `true`)
- `cron` (recurring, 5-field cron)
- `at` (one-time ISO-8601 timestamp)
- `profile` (optional; default `shared`)
- `provider` + `model` (optional; combined to `provider/model`)
- `model` alone (optional; treated as full model ref)
- `cwd` (optional; supports `~` expansion)
- `timeoutSeconds` (optional; default from daemon config)
- `output` (optional; structured delivery targets for post-run routing)
  - `when`: `success` | `failure` | `always` (default: `success`)
  - `targets`: list of gateway targets
    - Telegram: `{ gateway: "telegram", chatId: "..." }` or `chatIds: ["...", ...]`
    - Discord: `{ gateway: "discord", channelId: "..." }` or `channelIds: ["...", ...]`

## Examples

### Recurring task

```md
---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
model: "openai-codex/gpt-5.3-codex"
cwd: "~/agent-workspace"
timeoutSeconds: 1800
---
Summarize yesterday's work and suggest priorities for today.
```

### One-time task

```md
---
id: tax-checklist
at: "2026-04-15T09:00:00-04:00"
profile: "shared"
model: "openai-codex/gpt-5.3-codex"
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "123456789"
    - gateway: discord
      channelId: "987654321"
---
Prepare a tax filing checklist.
```

## Runtime behavior (important)

- Each run uses a **separate `pi` process**
- Retries: up to 3 attempts per scheduled run
- Missed runs while daemon is down: **skipped**
- Overlap policy: if still running at next due time, next run is **skipped**
- One-time tasks: marked complete on success, then reaped after 7 days
- No daemon-level post-run commit/PR automation; any git action must be explicit in prompt

## Agent workflow

1. Clarify schedule (`cron` vs `at`), profile, model, cwd.
2. Write or update `~/.config/personal-agent/tasks/<name>.task.md`.
3. Validate frontmatter keys match the supported contract above.
4. Check daemon/task health:
   - `pa daemon status` (shows configured task directory)
   - `pa tasks list`
   - confirm `tasks` module is enabled/active.
5. Validate definitions before waiting for schedule:
   - `pa tasks validate --all`
6. Verify execution:
   - `pa tasks show <id>`
   - `pa tasks logs <id> --tail 120`

## Debug checklist

- Parse errors: check daemon logs and frontmatter format.
- Task never runs: verify schedule is due and daemon is running.
- Model mismatch: use `model: provider/model` or provide both `provider` and `model`.
- Wrong directory behavior: set `cwd` explicitly.
- Long runs killed: increase `timeoutSeconds`.
