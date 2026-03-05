# personal-agent repo instructions

- Prefer settings in a settings file and not in environment variables.
- Do not worry about backwards compatibility; this is personal software. Prefer correct implementations over small patches that incur tech debt.

## AGENTS ownership model

- Do not use `profiles/shared/agent/AGENTS.md`.
- Keep one `AGENTS.md` per non-shared profile at `profiles/<profile>/agent/AGENTS.md`.
- Duplicate shared guidance across profile AGENTS files when needed; do not centralize behavior rules in shared AGENTS.
- Memory and behavior updates should target the active profile's AGENTS path.

## Profile workspace convention

- Each non-shared profile keeps project-specific context under `profiles/<profile>/agent/workspace/`.
- There is never a shared-profile workspace (`profiles/shared/agent/workspace` should not exist).
- Workspace docs are available to the agent via normal file tools (`read`, `edit`, `write`).
- Use workspace docs for project-local briefs, runbooks, specs, and notes.
- Recommended layout:
  - `workspace/projects/<project-slug>/PROJECT.md`
  - `workspace/projects/<project-slug>/runbooks/`
  - `workspace/projects/<project-slug>/specs/`
  - `workspace/projects/<project-slug>/notes/`
- Keep reusable cross-project workflows in `skills/`; keep durable behavior/preferences in `AGENTS.md`.
- For project work, read that project's `PROJECT.md` first when present.
