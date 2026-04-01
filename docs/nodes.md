# Nodes

Nodes are the unified durable file model for `personal-agent`.

Everything durable in the shared knowledge layer now converges on one directory shape under `sync/nodes/`. Notes, skills, and projects are still useful *roles*, but they no longer need separate top-level storage to exist.

## Core model

A node is a directory with:

- required `INDEX.md`
- optional supporting directories such as `documents/`, `references/`, `attachments/`, `scripts/`, and `artifacts/`
- tag-driven semantics instead of hard type-specific schemas

`INDEX.md` is always the canonical entrypoint.

## Durable root

The canonical synced durable store is now:

- `~/.local/state/personal-agent/sync/nodes/<id>/`

Legacy roots under `sync/notes/`, `sync/projects/`, and `sync/skills/` still exist as migration inputs and compatibility surfaces while older code paths are phased over, but new unified tooling targets `sync/nodes/`.

## Directory layout

```text
nodes/<id>/
├── INDEX.md
├── documents/
├── references/
├── attachments/
├── scripts/
└── artifacts/
```

The exact supporting directories are conventions, not schema.

## `INDEX.md`

Every node starts with YAML frontmatter followed by markdown body content.

Example:

```yaml
---
id: unified-run-architecture
title: Unified Run Architecture
summary: Unify runs, scheduled tasks, and deferred resumes into one model.
description: Durable architecture note and implementation record.
status: active
createdAt: 2026-04-01T00:00:00.000Z
updatedAt: 2026-04-01T00:15:00.000Z
createdBy: patrick
tags:
  - type:project
  - profile:assistant
  - cwd:/Users/patrick/workingdir/personal-agent
  - area:architecture
  - status:active
links:
  parent: platform-architecture
  related:
    - daemon-unification
---

# Unified Run Architecture

Plain markdown body.
```

### Required frontmatter fields

Every node must define:

- `id`
- `title`
- `summary`

### Common optional frontmatter fields

Use these when they add value:

- `description`
- `status`
- `createdAt`
- `updatedAt`
- `createdBy`
- `tags[]`
- `links.parent`
- `links.related[]`
- `links.conversations[]`

## Tags

Tags use `key:value` strings.

### Reserved/core tags

These are the tags the runtime treats as first-class:

- `type:*` — purpose (`project`, `skill`, `note`, `runbook`, ...)
- `profile:*` — ownership/filtering context
- `status:*` — operational state
- `host:*` — machine identity when relevant
- `cwd:*` — working-directory affinity
- `parent:*` — denormalized parent lookup helper

### Free-form tags

Everything else is queryable but unconstrained:

- `area:backend`
- `team:platform`
- `lang:typescript`
- `topic:gpu`

The model is closer to Datadog-style event tags than a rigid schema.

## Parent/child hierarchy

Relationships are stored child → parent only.

```yaml
links:
  parent: parent-node-id
```

Nodes also carry `parent:<id>` in tags so children can be derived at read time with queries such as:

```text
parent:platform-architecture
```

The parent does not store children explicitly.

## Search

`pa node` and the node tool support tag + full-text queries with Lucene-style operators:

```text
type:project AND status:active
profile:assistant AND type:skill
parent:knowledge-system-gap-closure
"build deploy"
cwd:/Users/patrick/work/*
```

Search matches against:

- tags
- id, title, summary, description
- markdown body

## Roles inside one node system

### Note nodes

Use notes for reusable knowledge.

Convention:

- tag with `type:note` (or a more specific note role plus `type:note` when useful)
- keep the body human-readable
- use `references/` for supporting docs

### Skill nodes

Use skills for reusable procedures.

Convention:

- tag with `type:skill`
- keep Pi-compatible `name` and `description` frontmatter when the runtime needs skill loading
- store scripts and references alongside the node

### Project nodes

Use projects for tracked work.

Convention:

- tag with `type:project`
- keep goals, status, tasks, milestones, blockers, and progress in markdown sections
- prefer markdown checklists over separate task objects when you do not need heavy structure

## Migration

The unified node migration copies legacy note, skill, and project packages into `sync/nodes/`.

Current behavior:

- notes become `type:note` nodes
- skills become `type:skill` nodes
- projects become `type:project` nodes with markdown sections derived from legacy state
- cross-store id collisions are merged into a single node directory

Use:

```bash
pa node migrate
```

## CLI surface

The primary CLI is now:

```bash
pa node list
pa node find "type:skill AND profile:assistant"
pa node show agent-browser
pa node new quick-note --title "Quick note" --summary "Captured thought." --tag type:note
pa node tag quick-note --add area:notes
pa node lint
pa node migrate
```

## Agent surface

Live sessions now expose a `node` tool for durable node discovery and CRUD.

Use it for:

- shared note lookup
- project/skill discovery
- tag-based filtering
- lightweight durable updates

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [Projects](./projects.md)
- [Command-Line Guide (`pa`)](./command-line.md)
