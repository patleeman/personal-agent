# personal-agent repo instructions

- Prefer settings in a settings file and not in environment variables.
- Do not worry about backwards compatibility; this is personal software. Prefer correct implementations over small patches that incur tech debt.

## AGENTS ownership model

- Do not use `profiles/shared/agent/AGENTS.md`.
- Keep one `AGENTS.md` per non-shared profile at `profiles/<profile>/agent/AGENTS.md`.
- Duplicate shared guidance across profile AGENTS files when needed; do not centralize behavior rules in shared AGENTS.
- Memory and behavior updates should target the active profile's AGENTS path.

## Profile memory convention

- Each non-shared profile keeps project-specific context under `profiles/<profile>/agent/memory/`.
- There is never a shared-profile memory dir (`profiles/shared/agent/memory` should not exist).
- Memory docs are available to the agent via normal file tools (`read`, `edit`, `write`).
- Use memory docs for project-local briefs, runbooks, specs, and notes.
- Keep memory docs flat at `memory/*.md` (no nested project tree).
- Every memory doc must include YAML frontmatter with at least: `id`, `title`, `summary`, `tags`, `updated`.
- Use `pa memory list/find/show/new/lint` for discovery, creation, and validation.
- Keep non-markdown automation state outside memory (for example `agent/state/...`).
- Keep reusable cross-project workflows in `skills/`; keep durable behavior/preferences in `AGENTS.md`.

## Conversation locality boundary

- Conversations and session ids are local runtime state, not portable profile state.
- Do not add repo-managed files or portable metadata keyed by conversation id. This includes things like `profiles/<profile>/agent/conversations/`, repo-managed frontmatter fields such as `relatedConversationIds`, or any other portable schema that persists conversation ids.
- If a portable artifact needs to relate to interactive work, use stable portable identifiers (for example project ids, task ids, artifact paths, timestamps) and keep any conversation↔artifact mapping under local state in `~/.local/state/personal-agent/**`.
- Treat conversation identity as machine-local/private context that must not leak into versioned repo resources just because `.gitignore` would hide new files.

##  Development 

- For personal-agent web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.

## UI Design Bans

- For personal-agent web UI work, BANNED: nested bordered containers/cards (`boxes inside boxes`). Do not stack inset panels, card-within-card layouts, or form wrappers inside larger bordered boxes unless there is a truly unavoidable reason.
- For personal-agent web UI work, BANNED: overusing pills/chips as a default UI treatment. Use pills only when they are semantically justified (for example compact status or tags), not as a repeated decorative pattern.
- Prefer flatter layouts with spacing, typography, and alignment creating hierarchy instead of extra borders and pill chrome.