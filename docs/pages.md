# Pages

Pages are the universal durable unit in `personal-agent`.

A page is a place for information. It can contain content, link to other pages, sit under a parent page, carry tags, and include supporting files when needed.

This is the user-facing model.

Internally, the storage still lives under `sync/nodes/` for now, but the product model is **pages first**.

## Core model

A page is a directory with:

- required `INDEX.md`
- optional supporting directories such as `documents/`, `references/`, `attachments/`, `scripts/`, and `artifacts/`
- lightweight structure through frontmatter, tags, relationships, and supporting files

`INDEX.md` is always the canonical entrypoint.

## Durable root

The canonical synced durable store is still:

- `~/.local/state/personal-agent/sync/nodes/<id>/`

That path is an implementation detail. The user model is:

- **page** = durable thing
- **note / project / skill** = page role or workflow lens

## What pages can do

Pages can:

- hold markdown content
- link to other pages
- have a parent page
- carry tags
- expose optional properties like status
- include supporting files

That is the whole base object.

Everything else should be layered on top of it.

## Page roles

`personal-agent` still has recognizable constructs, but they are not separate storage objects anymore.

### Note pages

Use note pages for reusable knowledge.

Examples:

- references
- runbooks
- research notes
- architecture notes
- decision summaries

Convention:

- tag with `type:note` when that helps retrieval
- keep the body human-readable
- use `references/` for supporting material

### Skill pages

Use skill pages for reusable procedures.

Examples:

- browser automation workflows
- release workflows
- operating runbooks

Convention:

- tag with `type:skill`
- keep Pi-compatible `name` and `description` frontmatter when runtime loading needs it
- store scripts and references alongside the page

### Project pages

Use project pages for tracked work.

Examples:

- active goals
- blockers
- milestones
- handoff context
- project-local files

Convention:

- tag with `type:project`
- keep goals, status, blockers, and progress in markdown sections
- use supporting files when the project needs attachments, notes, or artifacts

## `INDEX.md`

Every page starts with YAML frontmatter followed by markdown body content.

Example:

```yaml
---
id: unified-run-architecture
title: Unified Run Architecture
summary: Unify runs, scheduled tasks, and deferred resumes into one model.
description: Durable architecture page and implementation record.
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

Every page must define:

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
- `links.relationships[]`

## Tags

Tags use `key:value` strings.

### Reserved/core tags

These are the tags the runtime treats as first-class:

- `type:*` — page role (`project`, `skill`, `note`, `runbook`, ...)
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

## Parent/child hierarchy

Relationships are stored child → parent only.

```yaml
links:
  parent: parent-page-id
```

Pages also carry `parent:<id>` in tags so children can be derived at read time with queries such as:

```text
parent:platform-architecture
```

The parent does not store children explicitly.

## Search

`pa page` and the current unified page tool support tag + full-text queries with Lucene-style operators:

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

## UI model

The shared browser at `/pages` is the page workspace.

From there you can:

- browse notes, projects, and skills together
- create a new page and shape it toward a note, project, or skill
- open shared page metadata on the right
- edit parent, status, and structured tags
- move into dedicated note / project / skill editors when needed

## Migration and compatibility

Current compatibility rules:

- storage remains under `sync/nodes/`
- `pa page` is the preferred CLI surface
- `pa node` remains as a compatibility alias
- older `/nodes` URLs redirect to `/pages`

## Related docs

- [Knowledge Management System](./knowledge-system.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [Projects](./projects.md)
- [Command-Line Guide (`pa`)](./command-line.md)
- [Nodes (legacy/internal term)](./nodes.md)
