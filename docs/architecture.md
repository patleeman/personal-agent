# Personal-Agent Architecture

## Goal

`personal-agent` is a thin application layer on top of Pi that provides:

- repo-managed resources (profiles, skills, extensions, themes, prompts)
- local runtime state (auth, sessions, daemon state, gateway spools)
- a wrapper CLI (`pa`) for deterministic profile launches
- chat gateway (Telegram) that reuses the same profile/runtime plumbing
- one shared local daemon (`personal-agentd`) for background orchestration

No symlink sync workflows are required.

---

## Package boundaries

### `@personal-agent/core`

Owns runtime safety primitives:

- runtime path resolution (`resolveStatePaths`)
- path safety checks (state paths must be outside repo)
- runtime directory bootstrap/writability checks
- Pi runtime agent dir preparation (`pi-agent`, auth/session initialization)

### `@personal-agent/resources`

Owns profile discovery + materialization:

- profile layer resolution (`shared` → selected profile → optional local overlay)
- merge of `settings.json` and `models.json`
- AGENTS/SYSTEM/APPEND_SYSTEM resolution rules
- extension/skill/prompt/theme discovery
- deterministic Pi resource args (`--skill`, `-e`, `--prompt-template`, `--theme`)

### `@personal-agent/daemon`

Owns background orchestration:

- local JSONL IPC server over Unix socket
- bounded event queue + in-process event bus
- built-in modules:
  - `maintenance`
  - `tasks`
  - `deferred-resume`
- module status/diagnostics + queue status
- gateway notification queue (for task output routing)
- deferred-resume firing when a queued conversation continuation becomes due

### `@personal-agent/cli`

Owns user-facing CLI command surface:

- Pi passthrough: `pa tui ...`, `pa <pi args>`
- management commands: `profile`, `doctor`, `daemon`, `tasks`, `restart`, `update`
- profile resolution + runtime materialization + Pi launch
- non-fatal daemon event emission from CLI runs

### `@personal-agent/gateway`

Owns Telegram transport:

- allowlist access control
- per-chat/per-channel persisted Pi sessions
- durable Telegram inbox replay for crash recovery
- slash command handling (`/status`, `/new`, `/model`, `/tasks`, `/followup`, ...)
- daemon event emission + notification pull for scheduled task outputs

---

## Resource layering

For active profile `<p>`:

1. `profiles/shared/agent`
2. `profiles/<p>/agent`
3. optional local overlay (`~/.config/personal-agent/local` by default)

Examples:

- Skills are layered by directory (`--skill` for each discovered skill dir)
- `SYSTEM.md` is highest-precedence file wins
- `AGENTS.md` and `APPEND_SYSTEM.md` are concatenated in layer order

See [Profile Schema](./profile-schema.md).

---

## Runtime ownership model

### Repo-managed (versioned)

- `profiles/**`
- package source + tests
- docs

### Local mutable (not versioned)

Default root: `~/.local/state/personal-agent`

- `pi-agent/auth.json`
- `pi-agent/sessions/**`
- `daemon/**` (socket, pid, logs, task state, task run logs)
- `gateway/**` (provider logs, durable pending inbox)

---

## End-to-end flows

## CLI flow (`pa tui` / passthrough)

1. resolve selected profile
2. resolve and validate runtime state paths
3. bootstrap runtime dirs and prepare runtime Pi agent dir
4. materialize merged profile artifacts into runtime agent dir
5. auto-install extension dependencies when missing
6. decide interactive vs non-interactive Pi launch mode
7. launch Pi directly with explicit resource args and `PI_CODING_AGENT_DIR`
8. emit daemon events for direct Pi runs (non-fatal if daemon unavailable)

## Gateway flow (`pa gateway ... start`)

1. load gateway config + env overrides
2. resolve token/allowlist (including optional `op://` references)
3. ensure daemon is running (unless daemon events disabled)
4. process inbound messages with per-chat/per-channel persisted sessions
5. emit session events to daemon
6. poll daemon notification queue and deliver routed task outputs

---

## Event model (high-level)

Examples of emitted events:

- `session.updated`
- `session.closed`
- `session.processing.failed`
- `pi.run.completed`
- `pi.run.failed`
- timer events (`timer.maintenance.cleanup`, `timer.tasks.tick`)
- `gateway.notification` (queued for gateway delivery)

Delivery behavior is at-most-once with bounded queue semantics.

---

## Memory model

Memory is profile-driven:

- `AGENTS.md` stores durable behavior constraints and stable facts (one per non-shared profile; no shared AGENTS ownership)
- `skills/` stores reusable workflows and domain knowledge
- `agent/memory/*.md` can store non-shared profile memory docs (briefs/runbooks/specs/notes) with YAML frontmatter; these files are repo-managed but not auto-loaded as Pi resources
- There is no shared-profile memory dir (`profiles/shared/agent/memory`)

The `memory` extension injects active-profile memory policy guidance into the system prompt on each turn.

---

## Related docs

- [CLI Guide](./cli.md)
- [Configuration](./configuration.md)
- [Daemon Architecture](./daemon-architecture.md)
- [Scheduled Tasks](./tasks.md)
- [Gateway Guide](./gateway.md)
- [Extensions Guide](./extensions.md)
