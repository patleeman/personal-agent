# Personal-Agent Architecture

## Goal

`personal-agent` is a thin application layer on top of Pi:

- repo-managed resources (profiles, skills, extensions, themes, prompts)
- local-only runtime state (auth, sessions, cache)
- wrapper CLI + Telegram gateway using the same profile/runtime plumbing
- one shared daemon for background orchestration

No symlink chains and no manual "apply/syncback" workflow.

## Package boundaries

## `@personal-agent/core`

Owns **runtime state safety** and **profile data merge primitives**:

- profile data schema + validation + merge engine (`packages/core/src/profile/*`)
- runtime path resolution (`packages/core/src/runtime/paths.ts`)
- runtime bootstrap checks (`packages/core/src/runtime/bootstrap.ts`)
- Pi runtime dir preparation (`packages/core/src/runtime/agent-dir.ts`)

Out of scope:

- profile filesystem discovery
- CLI command parsing
- Telegram transport

## `@personal-agent/resources`

Owns **repo profile discovery and materialization**:

- list/resolve profiles from `profiles/*/agent`
- merge layered `settings.json` and `models.json`
- combine AGENTS/SYSTEM/APPEND_SYSTEM into runtime agent dir
- produce Pi CLI resource args (`--skill`, `-e`, `--theme`, ...)

Layer order:

1. `shared`
2. selected profile (for example `datadog`)
3. optional local overlay (`~/.config/personal-agent/local`)

## `@personal-agent/daemon`

Owns background orchestration via one local process (`personal-agentd`):

- in-process event bus
- JSONL IPC server over Unix socket
- module lifecycle and subscriptions
- timer-driven event emission for scheduled work
- queue/module diagnostics

Built-in modules:

- `memory` (session summary + `qmd` update/embed scheduling)
- `maintenance` (periodic cleanup)

## `@personal-agent/cli`

Owns user-facing local commands:

- `personal-agent run`
- `personal-agent profile list/show/use`
- `personal-agent doctor`
- `personal-agent daemon start|stop|status|restart|logs`

Responsibilities:

- select profile
- ensure runtime state is writable and outside repo
- materialize profile into runtime Pi agent dir
- launch `pi` with deterministic resource flags
- emit non-fatal daemon events for background processing

## `@personal-agent/gateway`

Owns Telegram transport:

- allowlist-based access control
- one Pi session file per chat
- reuse core/runtime/resources logic
- invoke `pi -p --session <chat-session>` for replies
- emit non-fatal daemon events (`session.updated` / `session.closed`)

## Runtime ownership model

### Repo-managed (versioned)

- `profiles/shared/agent/**`
- `profiles/datadog/agent/**`
- package source and tests

### Local mutable (not versioned)

Default root: `~/.local/state/personal-agent`

- `pi-agent/auth.json`
- `pi-agent/sessions/**`
- `pi-agent/*` runtime artifacts
- telegram session files under runtime session directory

## Data flow

1. User selects profile (`shared`/`datadog`)
2. resources resolves profile layers from repo + optional local overlay
3. core validates/bootstrap runtime paths
4. resources materializes merged runtime config into runtime Pi agent dir
5. cli/gateway execute Pi with the same resolved profile resources
6. cli/gateway emit events to `personal-agentd` (non-fatal if unavailable)
7. daemon modules process queued and timer-emitted events
