# Profiles, Notes, and Skills

Profiles are how `personal-agent` changes behavior, prompting, defaults, and reusable capabilities around a synced durable resource store.

A profile is not just a name. It is the durable resource bundle the agent runs with, selected from kind-based synced resources plus machine-local overlays.

See [Nodes](./nodes.md) for the canonical on-disk node spec.

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

## Note nodes: durable knowledge hubs

Notes are durable knowledge nodes.

Use them for:

- runbooks
- research notes
- domain references
- architecture notes
- decision summaries
- distilled conversation captures
- structure notes / maps of content

A note node is a directory with an `INDEX.md` file. Supporting directories are freeform.

```text
note-id/
├── INDEX.md
├── references/
└── assets/
```

Typical note-node frontmatter:

```md
---
id: personal-agent
kind: note
title: Personal-agent knowledge hub
summary: Durable knowledge hub for personal-agent architecture, UI decisions, and workflows.
status: active
tags:
  - personal-agent
  - architecture
  - structure
updatedAt: 2026-03-26
metadata:
  area: personal-agent
  type: note
---
```

Use tag `structure` when a note mostly organizes other notes.
There is no separate hub kind.

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

## Commands you will use

### Profile commands

```bash
pa profile list
pa profile show
pa profile use <name>
```

### Note-node commands

```bash
pa memory list
pa memory find --tag notes
pa memory show <id>
pa memory new <id> --title "..." --summary "..." --tags tag1,tag2
pa memory lint
```

The command name is still `pa memory`, but it now operates on shared note nodes under `sync/notes/`.

`pa memory new` scaffolds `notes/<note-id>/INDEX.md`.

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

- [Nodes](./nodes.md)
- [How personal-agent works](./how-it-works.md)
- [Projects](./projects.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Inbox and Activity](./inbox.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)
