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

##  Development 

- For personal-agent web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.

## UI Design Bans

- For personal-agent web UI work, BANNED: nested bordered containers/cards (`boxes inside boxes`). Do not stack inset panels, card-within-card layouts, or form wrappers inside larger bordered boxes unless there is a truly unavoidable reason.
- For personal-agent web UI work, BANNED: overusing pills/chips as a default UI treatment. Use pills only when they are semantically justified (for example compact status or tags), not as a repeated decorative pattern.
- Prefer flatter layouts with spacing, typography, and alignment creating hierarchy instead of extra borders and pill chrome.