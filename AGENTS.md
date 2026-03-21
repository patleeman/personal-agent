# personal-agent repo instructions

- Prefer durable settings files over introducing new user-facing environment variables. Use env vars only for existing local/runtime wiring.
- This is personal software. Prefer correct implementations over backwards-compatibility layers.

## AGENTS ownership model

- Do not use shared/default `AGENTS.md` files for durable behavior.
- Keep one `AGENTS.md` per non-shared profile at `~/.local/state/personal-agent/profiles/<profile>/agent/AGENTS.md`.
- This repo should only carry shared defaults under `defaults/agent` plus repo-built-in runtime capabilities under `extensions/` and `themes/`; profile skills and non-shared profile state belong in the state root/state repo.
- Duplicate shared guidance across profile AGENTS files when needed; do not centralize behavior rules in shared AGENTS.
- Memory and behavior updates should target the active profile's AGENTS path.

## Global memory convention

- Durable memories live in the shared global store at `~/.local/state/personal-agent/profiles/_memory/`.
- There is never a shared-profile memory dir (`~/.local/state/personal-agent/profiles/shared/agent/memory` should not exist).
- A memory is a directory containing `MEMORY.md`, plus optional `references/` and `assets/`.
- Memory packages are available via the memory tool when present and via normal file tools (`read`, `edit`, `write`) when needed.
- Use memory packages for durable briefs, runbooks, specs, and notes that should be reusable across profile contexts.
- Keep top-level memories as curated hubs under `profiles/_memory/<memory-name>/MEMORY.md`; break down detailed material inside each package instead of flattening the root.
- Every `MEMORY.md` must include YAML frontmatter with at least: `name`, `description`, and optional `metadata`.
- Prefer the memory tool when available; otherwise use `pa memory list/find/show/new/lint` for discovery, creation, and validation.
- Keep non-markdown automation state outside memory packages.
- Keep reusable cross-project workflows in profile `skills/` dirs under the state root; keep durable behavior/preferences in profile `AGENTS.md` files.

## Conversation locality boundary

- Conversations and session ids are local runtime state, not portable profile state.
- Do not add portable profile files or metadata keyed by conversation id. This includes things like `~/.local/state/personal-agent/profiles/<profile>/agent/conversations/`, frontmatter fields such as `relatedConversationIds`, or any other portable schema that persists conversation ids.
- If a portable artifact needs to relate to interactive work, use stable portable identifiers (for example project ids, task ids, artifact paths, timestamps) and keep any conversation↔artifact mapping under local state in `~/.local/state/personal-agent/**`.
- Treat conversation identity as machine-local/private context that must not leak into versioned repo resources just because `.gitignore` would hide new files.

## Development

- For personal-agent web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.