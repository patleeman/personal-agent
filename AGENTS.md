# personal-agent repo instructions

- Prefer durable settings files over introducing new user-facing environment variables. Use env vars only for existing local/runtime wiring.
- This is personal software. Prefer correct implementations over backwards-compatibility layers.

## AGENTS ownership model

- Do not use shared/default `AGENTS.md` files for durable behavior.
- Keep one `AGENTS.md` per non-shared profile at `~/.local/state/personal-agent/profiles/<profile>/agent/AGENTS.md`.
- This repo should only carry shared defaults under `defaults/agent` plus repo-built-in runtime capabilities under `extensions/` and `themes/`; profile skills and non-shared profile state belong in the state root/state repo.
- Duplicate shared guidance across profile AGENTS files when needed; do not centralize behavior rules in shared AGENTS.
- Memory and behavior updates should target the active profile's AGENTS path.

## Global node convention

- Durable note nodes live in the shared synced store at `~/.local/state/personal-agent/sync/notes/`.
- There is never a profile-local synced memory dir (`~/.local/state/personal-agent/profiles/shared/agent/memory` should not exist).
- A node is a directory containing `INDEX.md`, plus optional `state.yaml` and supporting directories such as `references/`, `assets/`, or `scripts/`.
- Note nodes are available via the memory tool when present and via normal file tools (`read`, `edit`, `write`) when needed.
- Use note nodes for durable briefs, runbooks, specs, and notes that should be reusable across profile contexts.
- Structure notes are ordinary note nodes with links and, when helpful, a `structure` tag.
- Every node `INDEX.md` must include YAML frontmatter with at least: `id`, `kind`, `title`, and `summary`.
- Skill nodes must also keep Pi-compatible `name` and `description` frontmatter.
- Prefer the memory tool when available; otherwise use `pa memory list/find/show/new/lint` for note-node discovery and validation.
- Keep non-markdown automation state outside note nodes.
- Keep reusable cross-project workflows in synced `skills/` node dirs under the state root; keep durable behavior/preferences in profile `AGENTS.md` files.

## Conversation locality boundary

- Conversations and session ids are local runtime state, not portable profile state.
- Do not add portable profile files or metadata keyed by conversation id. This includes things like `~/.local/state/personal-agent/profiles/<profile>/agent/conversations/`, frontmatter fields such as `relatedConversationIds`, or any other portable schema that persists conversation ids.
- If a portable artifact needs to relate to interactive work, use stable portable identifiers (for example project ids, task ids, artifact paths, timestamps) and keep any conversation↔artifact mapping under local state in `~/.local/state/personal-agent/**`.
- Treat conversation identity as machine-local/private context that must not leak into versioned repo resources just because `.gitignore` would hide new files.

## Development

- For personal-agent web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.

## TEST YOUR WORK

- For personal-agent web UI work, after you complete a feature, make sure you actually inspect your work. Spin up the UI on a separate port and use agent-browser to inspect and interact with your changes. Make sure the work is complete, to spec, works without bugs, and looks good.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.
