# Nodes

Nodes are the unified durable file model for `personal-agent`.

They replace the old split between:

- skill packages (`SKILL.md`)
- memory packages (`MEMORY.md`)
- project records (`PROJECT.yaml` + `BRIEF.md`)

The canonical durable node kinds are exactly:

- `note`
- `project`
- `skill`

There is no `hub` kind. A structure note is just a `note` with links and, when helpful, a `structure` tag.

## Core model

A node is a directory with:

- required `INDEX.md`
- optional `state.yaml`
- optional kind-specific supporting directories such as `references/`, `notes/`, `scripts/`, `assets/`, `attachments/`, and `artifacts/`

`INDEX.md` is always the canonical human entrypoint.

`state.yaml` is for compact machine-readable state when the node has structured operational data.

## Durable roots

The synced durable store now uses these roots:

- `~/.local/state/personal-agent/sync/notes/<id>/`
- `~/.local/state/personal-agent/sync/projects/<id>/`
- `~/.local/state/personal-agent/sync/skills/<id>/`

Profiles, agents, settings, models, tasks, and other runtime state keep their existing roots.

## `INDEX.md`

Every node `INDEX.md` starts with YAML frontmatter followed by markdown body content.

Shared frontmatter fields:

```yaml
---
id: node-format-migration
kind: project
title: Unify durable state as nodes
summary: Replace the split durable file model with unified nodes.
status: in_progress
createdAt: 2026-03-26T03:22:26.033Z
updatedAt: 2026-03-26T03:45:35.811Z
tags:
  - personal-agent
  - durable-state
links:
  related:
    - durable-state-model-v2
ownerProfile: assistant
metadata:
  area: personal-agent
---
```

### Required frontmatter fields

Every node must define:

- `id`
- `kind`
- `title`
- `summary`

### Common optional frontmatter fields

Use these when they add value:

- `status`
- `createdAt`
- `updatedAt`
- `tags`
- `links.parent`
- `links.related[]`
- `ownerProfile`
- `metadata`

### Body expectations

`INDEX.md` should explain the node well enough that a human or agent can understand what it is without reading supporting files first.

Prefer `INDEX.md` for:

- overview
- rationale
- narrative handoff
- interpretation
- links to related nodes
- durable prose

## `state.yaml`

`state.yaml` is optional.

Use it when the node has structured state that is easier to read or mutate as YAML than prose.

Guidelines:

- `project` nodes use `state.yaml`
- `skill` nodes may use `state.yaml`, but most do not need it
- `note` nodes rarely need `state.yaml`

Prefer `state.yaml` for:

- operational fields
- requirements and plan state
- blockers
- task lists
- compact structured metadata that should not live inline in prose

Do not put conversation ids or session ids in `state.yaml`.

## Kind-specific expectations

## Note nodes

Notes are durable knowledge nodes.

Use them for:

- evergreen notes
- references
- decision notes
- distilled conversation captures
- structure / map-of-content notes

Typical layout:

```text
notes/<id>/
├── INDEX.md
├── references/
└── assets/
```

A structure note is still `kind: note`.

Use tags or metadata instead of inventing extra kinds. For example:

- tag `structure` for a note that organizes other notes
- `metadata.type: reference` for reference-style notes
- `metadata.area: compute` for topical grouping

## Skill nodes

Skills are reusable procedure nodes.

Use them for:

- workflows
- runbooks
- operational procedures
- bundled scripts and references

Typical layout:

```text
skills/<id>/
├── INDEX.md
├── scripts/
├── references/
└── assets/
```

Skill nodes also keep Pi-compatible trigger metadata in `INDEX.md` frontmatter:

- `name`
- `description`

These fields are required in practice for runtime skill discovery.

Rules:

- `name` must match the skill directory name
- `id` should match `name`
- `summary` is the node-level summary
- `description` should stay trigger-focused for Pi skill loading

Example:

```yaml
---
id: tool-agent-browser
kind: skill
name: tool-agent-browser
description: Automate browsers and Electron apps with agent-browser.
title: Browser automation with agent-browser
summary: Native and headed browser automation workflows for validation and inspection.
---
```

## Project nodes

Projects are tracked work nodes.

Use them for:

- goals
- blockers
- current focus
- recent progress
- requirements
- plan/tasks/milestones
- human handoff narrative
- project notes and files

Typical layout:

```text
projects/<id>/
├── INDEX.md
├── state.yaml
├── notes/
├── attachments/
└── artifacts/
```

Project `INDEX.md` is the human handoff / overview document.

Project `state.yaml` is the structured project state.

Current `state.yaml` fields are:

```yaml
description: Replace the current durable file model.
repoRoot: /Users/patrick/workingdir/personal-agent
archivedAt: null
requirements:
  goal: Ship the node migration.
  acceptanceCriteria:
    - Docs exist.
    - Data is migrated.
blockers: []
currentFocus: Update runtime and UI code.
recentProgress:
  - Migrated durable note data.
planSummary: Finish code paths, then validate.
completionSummary: null
plan:
  currentMilestoneId: null
  milestones: []
  tasks: []
```

Project identity fields such as `id`, `title`, `summary`, `status`, `ownerProfile`, `createdAt`, and `updatedAt` live in `INDEX.md` frontmatter.

## Supporting directories

The node model standardizes the entry files, not every supporting subdirectory.

Supporting directories remain kind-specific and freeform.

Common patterns in this repo:

- note nodes: `references/`, `assets/`
- skill nodes: `scripts/`, `references/`, `assets/`
- project nodes: `notes/`, `attachments/`, `artifacts/`

## Linking and relationships

Use frontmatter links for machine-readable node relationships:

```yaml
links:
  parent: personal-agent
  related:
    - durable-state-model-v2
    - continuous-conversations
```

Use markdown links or plain `@id` references inside the body for narrative context.

In the web UI, prose editors support `@` mention autocomplete for node cross-references. Use stable node ids such as `@node-format-migration`, `@tool-agent-browser`, or `@durable-state-model-v2` so references stay durable even if titles change.

The UI also computes backlinks from these durable `@id` references, so note, project, and skill detail views can show both outgoing links and linked-from context.

## Terminology

Use these terms consistently:

- **node** — the universal durable directory unit
- **note node** — durable knowledge
- **skill node** — reusable workflow/procedure
- **project node** — tracked work state
- **INDEX.md** — canonical human entrypoint
- **state.yaml** — optional structured state file

Avoid the old terms when describing the canonical format:

- “memory package”
- “skill package”
- “project record”
- “brief file” as a separate canonical durable type

## Migration mapping

## Skills

Old:

```text
skills/<id>/SKILL.md
```

New:

```text
skills/<id>/INDEX.md
```

Migration rules:

- rename the skill entry file from `SKILL.md` to `INDEX.md`
- add node frontmatter fields: `id`, `kind: skill`, `title`, `summary`
- keep Pi-compatible `name` and `description`
- keep existing supporting `scripts/`, `references/`, and `assets/`
- update internal references from `SKILL.md` to `INDEX.md`

## Memory packages

Old:

```text
memory/<id>/MEMORY.md
```

New:

```text
notes/<id>/INDEX.md
```

Migration rules:

- move memory packages from `sync/memory/` to `sync/notes/`
- convert `MEMORY.md` frontmatter to node frontmatter in `INDEX.md`
- map hub-like note nodes to ordinary `note` nodes
- use tag `structure` instead of a hub role/kind
- keep `references/` and `assets/`
- preserve note-specific metadata under `metadata`

## Projects

Old:

```text
projects/<id>/PROJECT.yaml
projects/<id>/BRIEF.md
```

New:

```text
projects/<id>/state.yaml
projects/<id>/INDEX.md
```

Migration rules:

- rename `PROJECT.yaml` to `state.yaml`
- rename `BRIEF.md` to `INDEX.md`
- move structured project state into `state.yaml`
- move the handoff/brief narrative into `INDEX.md`
- place project identity fields in `INDEX.md` frontmatter
- preserve `notes/`, `attachments/`, and `artifacts/`

## Portability rule

Portable node files must never store:

- conversation ids
- session ids
- machine-local runtime bindings

Use stable ids, paths, timestamps, and summaries instead.

## Related docs

- [Projects](./projects.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [How personal-agent works](./how-it-works.md)
