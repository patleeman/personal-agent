# How personal-agent works

`personal-agent` wraps Pi with a durable state model.

The core idea is simple: keep shipped defaults in the repo, keep durable knowledge in a vault, and keep machine-local runtime state outside the repo.

## The three state layers

### 1. Repo-managed defaults

These ship in git and are shared by the repo itself:

- `extensions/`
- `internal-skills/`
- `prompt-catalog/`
- `docs/`

### 2. Durable knowledge vault

`<vault-root>` is the durable knowledge home.

Use it for:

- ordinary docs and doc packages
- `AGENTS.md` and other instruction files
- `skills/<skill>/SKILL.md`
- `projects/<projectId>/...`

This is where reusable knowledge belongs.

### 3. Machine-local runtime state

`<state-root>` is durable on one machine but is not the portable vault.

Important subtrees:

- `<config-root>/config.json` — machine config
- `<config-root>/profiles/` — machine-local profile settings and model config
- `<config-root>/local/` — machine-local settings/model/provider overrides
- `<state-root>/daemon/` — daemon socket, runtime DB, run logs
- `<state-root>/companion/` — companion host/device auth state
- `<state-root>/desktop/` — desktop state and logs
- `<state-root>/sync/` — durable session files and compatibility storage
- `<state-root>/knowledge-base/repo` — managed KB mirror when KB sync is enabled

## Runtime materialization

When `pa` launches Pi or the desktop app creates a live session, the runtime is assembled from layered inputs:

1. repo defaults
2. selected instruction files and skill directories
3. the effective vault root and any managed KB mirror
4. machine-local config and local overrides
5. built-in extensions and installed package sources
6. conversation-specific context such as cwd, attachments, and attached docs

## Durable surfaces

| Surface | Purpose | Home |
| --- | --- | --- |
| conversation | active execution | session state |
| doc | reusable knowledge | `<vault-root>` |
| skill | reusable workflow | `<vault-root>/skills/` |
| attached context doc | durable thread-scoped knowledge | conversation state + `<vault-root>` refs |
| project | durable structured ongoing work | `<vault-root>/projects/` |
| run | detached work started now | daemon state |
| scheduled task / automation | saved later or recurring work | daemon state |
| reminder | tell-me-later wakeup | reminder + wakeup state |
| conversation artifact | rendered output tied to one thread | conversation artifact state |
| project artifact | durable deliverable tied to a project | `<vault-root>/projects/<projectId>/artifacts/` |

## Supported operator surfaces

- - The **Electron desktop app** is the primary operator UI and serves routes through `personal-agent://app/`.
- `pa tui` launches Pi in the terminal for quick command-line sessions.
- The **iOS companion app** talks to the daemon companion API under `/companion/v1` after pairing.

There is no supported standalone browser UI server for day-to-day operation.

## Invariants

- conversations are execution, not the only durable store
- reusable knowledge should survive outside one thread
- instruction files are selected behavior inputs, not a second chat log
- machine-local runtime state should not leak into the shared vault
- async work should have an owner: a conversation, an automation, a project, or a reminder

## What docs are for

Use `docs/` for product semantics and current behavior.

Use `internal-skills/` when the question is about built-in runtime features such as runs, tasks, artifacts, or reminder behavior.

Use tool schemas for exact tool arguments.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge System](./knowledge-system.md)
- [Configuration](./configuration.md)
- [Conversations](./conversations.md)
- [Desktop App](./desktop-app.md)
