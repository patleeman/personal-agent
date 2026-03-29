# Profiles, AGENTS, Notes, and Skills

Profiles are how `personal-agent` changes behavior, prompting, defaults, and reusable capabilities around a synced durable resource store.

A profile is not just a name. It is the durable resource bundle the agent runs with, selected from kind-based synced resources plus machine-local overlays.

See [Nodes](./nodes.md) for the canonical on-disk node spec.

If you want the single conceptual overview of notes, skills, projects, and `AGENTS.md` as one memory system, start with [Knowledge Management System](./knowledge-system.md).

If you need Patrick-specific preferences or standing behavior, the active profile's `AGENTS.md` is the canonical home. Use this page to understand how that fits with notes, skills, projects, and layered resources.

## The layer model

Resources resolve in this order:

1. repo `defaults/agent` for shared default profile files
2. synced durable resource roots under `~/.local/state/personal-agent/sync/`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

In addition, repo built-ins are always available from:

- `extensions/`
- `themes/`

## What a profile can contain

The synced durable store can contain:

- `profiles/*.json`
- `profiles/<profile>/agent/AGENTS.md`
- `agents/**`
- `settings/**`
- `models/**`
- `skills/**`
- `notes/**`
- `tasks/*.task.md`
- `projects/<projectId>/{INDEX.md,state.yaml}`

Repo built-ins still provide:

- `extensions/`
- `themes/`
- prompt-catalog content

## Example layout

```text
<repo>/
├── defaults/
│   └── agent/
│       └── settings.json
├── extensions/
└── themes/

~/.local/state/personal-agent/
└── sync/
    ├── profiles/
    │   ├── assistant.json
    │   └── datadog.json
    ├── agents/
    ├── settings/
    ├── models/
    ├── skills/
    ├── notes/
    ├── tasks/
    └── projects/
```

## What belongs where

| Place | Use it for |
| --- | --- |
| `agents/**` | durable role, behavior rules, and operating policy fragments |
| `skills/<id>/INDEX.md` | reusable workflow skill nodes |
| `notes/<id>/INDEX.md` | shared durable note nodes |
| `notes/<id>/references/**` | detailed notes, distilled captures, and supporting breakdowns for that note |
| `notes/<id>/assets/**` | non-markdown assets used by that note node |
| `tasks/*.task.md` | scheduled automation |
| `projects/` | long-running tracked work |
| `settings/**` | default model, thinking, theme, and other runtime defaults |

## `AGENTS.md`: durable identity and behavior

`AGENTS.md` is where the durable behavioral contract lives.

Use it for:

- mission and role
- user preferences
- operating rules
- constraints and standing instructions

Do not use it for:

- transient project state
- one-off reminders
- conversation-local context

## Skill nodes: reusable workflows

Skills are reusable, named workflow nodes the agent can invoke when appropriate.

Use a skill node when you want something that is:

- reusable across conversations
- broader than one project
- procedural rather than purely referential

Examples:

- a morning report workflow
- a calendar workflow
- a Git or release workflow
- a browser-automation workflow

Skill nodes live under `skills/<id>/INDEX.md` and typically include supporting `scripts/`, `references/`, and `assets/` directories.

For Pi compatibility, skill node frontmatter keeps:

- `name`
- `description`

Alongside node fields such as:

- `id`
- `kind: skill`
- `title`
- `summary`

## Note nodes: durable knowledge and reference nodes

Notes are durable knowledge nodes.

Use them for:

- runbooks
- research notes
- domain references
- architecture notes
- decision summaries
- distilled conversation captures
- structure notes / maps of content when they genuinely help

A note node is a directory with an `INDEX.md` file. Supporting directories are freeform.

Notes may also include an optional `description` field for agent-facing guidance about how the note should be used or when it should be consulted.

```text
note-id/
├── INDEX.md
├── references/
└── assets/
```

Typical note-node frontmatter:

```md
---
id: desktop-gpu-server
kind: note
title: Desktop GPU-enabled server notes
summary: Reference facts for a local Ubuntu GPU-enabled server.
description: Use this note when deciding whether local desktop compute is a better fit than renting remote GPUs.
status: active
tags:
  - desktop
  - gpu
  - ubuntu
updatedAt: 2026-03-28
metadata:
  area: compute
  type: reference
---
```

Use tag `structure` when a note mostly organizes other notes.
There is no separate hub kind.

Do not create empty hub or index notes by default. If a topic already has a real project or skill home, put the content there instead of duplicating it as a top-level note.

## Project nodes

Projects are project nodes with:

- `projects/<id>/INDEX.md` for the human handoff / overview
- `projects/<id>/state.yaml` for structured state
- `notes/`, `attachments/`, and `artifacts/` for supporting material

See [Projects](./projects.md).

## Shared resources vs profile-targeted resources

Important convention:

- shared defaults can live in repo `defaults/agent` and shared-scoped durable files under `sync/`
- profile-targeted durable resources are selected by filename or metadata applicability
- durable note nodes live in the synced shared notes store at `sync/notes/`

In particular:

- there is no profile-local synced `memory/` directory
- behavior targeting belongs in durable `agents/**`, `settings/**`, `models/**`, and `skills/**`

## Notes vs projects vs inbox

This distinction still matters.

Use:

- **note nodes** for reusable durable knowledge
- **project nodes** for current tracked work state, handoff context, project notes, and project files
- **inbox** for asynchronous outcomes that need attention later

A good rule:

- if it is reusable knowledge, store it in a note node
- if it is about one piece of ongoing work, store it in a project node
- if it is an async event worth noticing, surface it in the inbox
- if it already has a project or skill home, do not also keep it as a duplicate top-level note

## Writing style for notes and projects

Use these defaults for durable node prose:

- keep ids stable and slug-like, but make titles human-readable
- keep `summary` to one sentence
- start `INDEX.md` with a plain-English opening
- keep overview docs high-signal and move long detail into `references/` or project `notes/`
- avoid placeholder sections, stale scaffolding, and empty structure pages
- update or remove stale text instead of letting it linger

## Commands you will use

### Profile commands

```bash
pa profile list
pa profile show
pa profile use <name>
```

### Note-node commands

```bash
pa note list
pa note find --type reference
pa note show <id>
pa note new <id> --title "..." --summary "..." --type reference
pa note lint
```

Use `pa note` to operate on shared note nodes under `sync/notes/`.

`pa note new` scaffolds `notes/<note-id>/INDEX.md`.

## Local overlay

The optional local overlay defaults to:

- `~/.local/state/personal-agent/config/local`

Use it for machine-local additions that should not live in the repo.

It can contain the same kinds of runtime resources as a profile layer, such as:

- skills
- prompts
- themes
- extensions
- settings overrides

## Important boundary for agents

Do not store conversation ids or session ids in portable durable files.

That includes:

- note-node frontmatter/metadata
- project node files
- activity frontmatter
- any profile-local schema meant to be portable

Conversation-local bindings belong in local runtime state.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Nodes](./nodes.md)
- [How personal-agent works](./how-it-works.md)
- [Projects](./projects.md)
- [Conversations](./conversations.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Inbox and Activity](./inbox.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)
