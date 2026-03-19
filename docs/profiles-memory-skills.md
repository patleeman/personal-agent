# Profiles, Memory, and Skills

Profiles are how `personal-agent` changes behavior, prompting, defaults, and reusable capabilities around a shared global memory store.

A profile is not just a name. It is the durable resource bundle the agent runs with, even though memories themselves are shared globally.

## The layer model

Resources resolve in this order:

1. repo `defaults/agent` for shared default profile files
2. mutable shared profile `~/.local/state/personal-agent/profiles/shared/agent` (when present)
3. mutable profiles root `~/.local/state/personal-agent/profiles/<selected-profile>/agent`
4. local overlay (`~/.local/state/personal-agent/config/local` by default)

In addition, repo built-ins are always available from:

- `extensions/`
- `themes/`

Think of it like this:

- `shared` holds common default profile files and shared profile skills when present
- repo built-ins hold product-shipped runtime capabilities
- the selected profile adds persona- or context-specific behavior
- the local overlay is for machine-local additions

## What a profile can contain

A profile layer can contain:

- `AGENTS.md`
- `settings.json`
- `models.json`
- `skills/`
- `extensions/`
- `prompts/`
- `themes/`

Non-shared profiles can also keep durable profile state in:

- `tasks/*.task.md`
- `projects/<projectId>/PROJECT.yaml`
- `activity/*.md`

Shared global memories live alongside profiles at:

- `~/.local/state/personal-agent/profiles/_memory/<memory-name>/MEMORY.md`

## Example layout

```text
<repo>/
├── defaults/
│   └── agent/
│       └── settings.json
├── extensions/
└── themes/

~/.local/state/personal-agent/
└── profiles/
    ├── _memory/
    │   ├── personal-agent/
    │   │   ├── MEMORY.md
    │   │   ├── references/
    │   │   └── assets/
    │   └── runpod/
    │       └── MEMORY.md
    ├── shared/
    │   └── agent/
    │       ├── settings.json
    │       ├── models.json
    │       ├── skills/
    │       ├── extensions/
    │       ├── prompts/
    │       └── themes/
    └── assistant/
        └── agent/
            ├── AGENTS.md
            ├── settings.json
            ├── tasks/
            ├── projects/
            └── activity/
```

## What belongs where

| Place | Use it for |
| --- | --- |
| `AGENTS.md` | durable role, behavior rules, and operating policy |
| `skills/` | reusable workflows or domain-specific capabilities |
| `profiles/_memory/<memory-name>/MEMORY.md` | shared durable knowledge hubs |
| `profiles/_memory/<memory-name>/references/**` | detailed notes, distilled captures, and supporting breakdowns for that hub |
| `profiles/_memory/<memory-name>/assets/**` | non-markdown assets used by that memory package |
| `tasks/*.task.md` | scheduled automation |
| `projects/` | long-running tracked work |
| `activity/` | inbox items created by the system or by explicit inbox commands |
| `settings.json` | default model, thinking, theme, and other runtime defaults |

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

## Skills: reusable workflows

Skills are reusable, named workflows the agent can invoke when appropriate.

Use a skill when you want something that is:

- reusable across conversations
- broader than one project
- more operational than a memory package

Examples:

- a morning report workflow
- a calendar workflow
- a Git or release workflow
- a browser-automation workflow

Skills show up in the system prompt as lightweight name + description hints. The full `SKILL.md` loads on demand.

## Memory packages: durable knowledge hubs

Memories mirror the skill packaging model.

A memory is a directory with a `MEMORY.md` file. Everything else is freeform.

```text
memory-name/
├── MEMORY.md
├── references/
└── assets/
```

`MEMORY.md` uses skill-style frontmatter:

```md
---
name: personal-agent
description: Durable knowledge hub for personal-agent architecture, UI decisions, and workflows.
metadata:
  title: Personal-agent knowledge hub
  tags:
    - personal-agent
    - architecture
    - ui
  updated: 2026-03-19
  status: active
---

# Personal-agent knowledge hub

Use this file as the hub overview. Link out to `references/` when the topic needs more structure.
```

Required frontmatter fields:

- `name`
- `description`

Optional frontmatter fields:

- `metadata` — arbitrary structured metadata used for status, tags, relationships, timestamps, and workflow-specific fields

Common metadata keys in this repo:

- `title`
- `tags`
- `updated`
- `type`
- `status`
- `area`
- `role`
- `parent`
- `related`

Use memory packages for:

- runbooks
- research notes
- domain references
- architecture notes
- decision summaries
- durable knowledge the agent should be able to discover from a short catalog

## Organizing memories

Prefer a sparse top-level memory root.

Good pattern:

1. create one top-level memory package per durable topic area
2. keep the hub overview in `MEMORY.md`
3. move detailed material into `references/`
4. keep supporting files in `assets/`
5. update an existing memory package instead of creating near-duplicates

The main idea is:

- **skills** are reusable workflows
- **memories** are reusable knowledge hubs

## Shared profile vs non-shared profiles

Important convention:

- `shared` is for common profile resources
- non-shared profiles are where profile-local `AGENTS.md`, skills, tasks, projects, and activity live
- durable memories live in the shared global memory store at `profiles/_memory/`

In particular:

- there is no shared-profile `memory/` directory
- profile-local `AGENTS.md` should live with the active non-shared profile

## Memory vs project vs inbox

This distinction matters.

Use:

- **memory** for durable reusable knowledge
- **project** for current tracked work state, project briefs, project notes, and project files tied to one piece of work
- **inbox** for asynchronous outcomes that need attention later

A good rule:

- if it is reusable knowledge, store it in memory
- if it is about one piece of ongoing work, store it in a project
- if it is an async event worth noticing, surface it in the inbox

## Commands you will use

### Profile commands

```bash
pa profile list
pa profile show
pa profile use <name>
```

### Memory commands

```bash
pa memory list
pa memory find --tag notes
pa memory show <id>
pa memory new <id> --title "..." --summary "..." --tags tag1,tag2
pa memory lint
```

`pa memory new` creates a new memory package and scaffolds `<memory-name>/MEMORY.md`.

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

- global memory package frontmatter/metadata
- project files
- activity frontmatter
- any profile-local schema meant to be portable

Conversation-local bindings belong in local runtime state.

## Related docs

- [How personal-agent works](./how-it-works.md)
- [Projects](./projects.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Inbox and Activity](./inbox.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)
