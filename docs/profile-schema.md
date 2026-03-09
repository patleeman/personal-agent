# Profile Schema

This document describes resource profile structure consumed by `@personal-agent/resources`.

## Profile directories

Profiles live under:

- `profiles/shared/agent` (**required**)
- `profiles/<name>/agent` (optional overlay)

Optional local overlay:

- default: `~/.config/personal-agent/local`
- override: `PERSONAL_AGENT_LOCAL_PROFILE_DIR`

If local overlay contains `agent/`, that subdir is used; otherwise the overlay dir itself is used as the layer root.

---

## Supported files/directories in each layer

- `settings.json` (optional)
- `models.json` (optional)
- `AGENTS.md` (optional; project policy uses profile-local AGENTS only, not `profiles/shared/agent/AGENTS.md`)
- `SYSTEM.md` (optional)
- `APPEND_SYSTEM.md` (optional)
- `extensions/` (optional)
- `skills/` (optional)
- `prompts/` (optional)
- `themes/` (optional)

### Optional profile memory + tasks conventions

For **non-shared profiles only**, you may keep profile-local memory docs under `agent/memory/` (recommended: flat `agent/memory/*.md`).

- There is no shared memory dir (`profiles/shared/agent/memory` is intentionally unused).
- Keep scheduled task definitions in `agent/tasks/*.task.md` (adjacent to `memory/`, not inside it).
- Keep non-markdown automation state outside memory docs (for example `agent/state/...`).
- Keep memory docs flat (`agent/memory/*.md`) with YAML frontmatter for machine-readable retrieval.
- There is also no shared AGENTS ownership; durable behavior memory should be edited in the active non-shared profile's `agent/AGENTS.md`.
- This is a **repo convention** for operational context (briefs, runbooks, specs).
- `agent/memory/` is **not** discovered/materialized as a Pi resource automatically.
- `agent/tasks/` is used by daemon task discovery when `modules.tasks.taskDir` includes the profile tree.
- Keep reusable cross-project instructions in `skills/` and durable behavior constraints in the active profile `AGENTS.md`.

---

## Layer precedence

Deterministic order:

1. `shared`
2. selected profile
3. local overlay

Higher layer wins where override semantics apply.

---

## Merge semantics

### JSON (`settings.json`, `models.json`)

- recursive object merge
- arrays are replaced by higher-layer arrays
- scalar values are replaced by higher-layer values

### Markdown context files

- `AGENTS.md`: concatenated in layer order by loader semantics, but repo policy is to keep AGENTS only in non-shared profile paths for clear ownership
- `APPEND_SYSTEM.md`: concatenated in layer order
- `SYSTEM.md`: highest-precedence file wins

---

## Discovery semantics

For resolved layers, resources are discovered as follows:

- `skills/` directories are passed as repeated `--skill <dir>`
- `extensions/` entries are discovered from:
  - `*.ts`, `*.js`
  - `<name>/index.ts`, `<name>/index.js`
- `prompts/` markdown files (`*.md`) are discovered recursively
- `themes/` json files (`*.json`) are discovered recursively

Dedupe is path-based, preserving first-seen order.

---

## Validation rules

- `profiles/shared/agent` must exist
- requested overlay profile must exist (except `shared`)
- local overlay is optional and included only when present
- missing optional files are ignored

---

## Related docs

- [CLI Guide](./cli.md)
- [Configuration](./configuration.md)
- [Extensions Guide](./extensions.md)
