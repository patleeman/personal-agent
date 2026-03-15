# Profiles, Memory, and Skills

Profiles are how `personal-agent` changes behavior, memory, defaults, and reusable capabilities.

A profile is not just a name. It is the durable resource bundle the agent runs with.

## The layer model

Resources resolve in this order:

1. repo `profiles/shared/agent` for shared default profile files
2. mutable profiles root `~/.local/state/personal-agent/profiles/<selected-profile>/agent`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

In addition, repo built-ins are always available from:

- `skills/`
- `extensions/`
- `themes/`

Think of it like this:

- `shared` holds common default profile files
- repo built-ins hold product-shipped capabilities
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

- `memory/*.md`
- `tasks/*.task.md`
- `projects/<projectId>/PROJECT.yaml`
- `activity/*.md`

## Example layout

```text
<repo>/
├── profiles/
│   └── shared/
│       └── agent/
│           ├── settings.json
│           └── models.json
├── skills/
├── extensions/
└── themes/

~/.local/state/personal-agent/
└── profiles/
    └── assistant/
        └── agent/
            ├── AGENTS.md
            ├── settings.json
            ├── memory/
            ├── tasks/
            ├── projects/
            └── activity/
```

## What belongs where

| Place | Use it for |
| --- | --- |
| `AGENTS.md` | durable role, behavior rules, and operating policy |
| `skills/` | reusable workflows or domain-specific capabilities |
| `memory/*.md` | durable notes, briefs, specs, references, and learned patterns |
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
- more operational than a memory note

Examples:

- a morning report workflow
- a calendar workflow
- a Git or release workflow
- a browser-automation workflow

Skills show up in the Memory page and can also be invoked from supported interfaces like Telegram slash commands.

## Memory docs: durable notes and references

Memory docs live under:

- `~/.local/state/personal-agent/profiles/<profile>/agent/memory/*.md`

They are flat Markdown files with YAML frontmatter.

Required frontmatter fields:

- `id`
- `title`
- `summary`
- `tags`
- `updated`

Typical optional fields:

- `type`
- `status`

Example:

```md
---
id: runbook-ci-failures
title: "CI failure runbook"
summary: "Common checks when CI fails in this repo."
type: "runbook"
status: "active"
tags:
  - ci
  - runbook
  - debugging
updated: 2026-03-12
---

# CI failure runbook

Document the checks, commands, and patterns the agent should reuse later.
```

Use memory docs for:

- runbooks
- research notes
- domain references
- architecture notes
- decision summaries

## Shared profile vs non-shared profiles

Important convention:

- `shared` is for common resources
- non-shared profiles are where durable profile-local memory lives

In particular:

- there is no shared `memory/` directory
- profile-local `AGENTS.md` should live with the active non-shared profile

## Memory vs project vs inbox

This distinction matters.

Use:

- **memory** for durable knowledge
- **project** for current tracked execution state, project briefs, project notes, and project files tied to one piece of work
- **inbox** for asynchronous outcomes that need attention

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

### Memory doc commands

```bash
pa memory list
pa memory find --tag notes
pa memory show <id>
pa memory new <id> --title "..." --summary "..." --tags tag1,tag2
pa memory lint
```

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

Do not store conversation ids or session ids in repo-managed profile files.

That includes:

- memory docs
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
