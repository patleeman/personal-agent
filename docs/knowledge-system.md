# Knowledge System

Use this doc for the durable knowledge model.

## The four durable content types

### 1. Instruction files

Instruction files shape agent behavior.

Use them for:

- standing policy
- role and mission
- workflow defaults
- operating constraints

They are selected through config or Settings. `AGENTS.md` is the strongest convention, but not the only valid filename.

### 2. Docs

Docs are the default unit of durable knowledge.

Use them for:

- architecture notes
- reference material
- research
- design notes
- plans that should outlive a thread

A doc can be a single markdown file or a folder with `INDEX.md`.

### 3. Skills

Skills are reusable workflow packages.

Shared contract:

```text
<vault-root>/skills/<skill>/SKILL.md
```

Use a skill when the content is procedural and should be invoked again later.

### 4. Projects

Projects are optional structured work packages.

Use them only when the work needs durable machine-readable state such as milestones, blockers, tasks, or validation.

Shared contract:

```text
<vault-root>/projects/<projectId>/
```

See [Projects](./projects.md).

## What is special vs freeform

Special durable contracts:

- selected instruction files
- `<vault-root>/skills/<skill>/SKILL.md`
- `<vault-root>/projects/<projectId>/...`
- conversation mentions and attached context docs

Freeform conventions:

- `notes/`
- `references/`
- `systems/`
- `people/`
- any other folder taxonomy you choose for normal docs

Folder names can be useful, but they should not carry more product meaning than the actual file content.

## Effective vault root

`<vault-root>` resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. managed KB mirror at `<state-root>/knowledge-base/repo` when `knowledgeBaseRepoUrl` is configured
3. `vaultRoot` from `<config-root>/config.json`
4. default `~/Documents/personal-agent`

In Patrick's active setup, assume the managed KB mirror unless you know otherwise.

When managed sync is first pointed at an empty or bootstrap-only repo, PA imports files from the old unmanaged vault root (`vaultRoot` from config, or the default path when unset) into the managed mirror before pushing. It does not auto-import into a non-empty repo.

## Conversation interaction with the vault

A conversation can use durable knowledge in two different ways:

- `@file-or-doc` for one turn
- attached context docs for durable thread-scoped context

That keeps the roles clean:

- the vault stores the source document
- the conversation stores a reference to the document
- the agent loads the exact file only when needed

## Managed git sync status

When managed KB sync is enabled, the Knowledge page sidebar shows the mirror's current git sync state.

It can surface:

- in sync
- pending local changes
- pending local commits or remote commits
- sync in progress or the latest sync error

That status is about the managed mirror under `<state-root>/knowledge-base/repo`, not an arbitrary overridden vault root.

If the managed repo is still empty after sync, check whether the old unmanaged vault root actually had content worth importing.

## URL import

The web UI Knowledge page can import a web page into `<vault-root>`.

Use that when the right move is “save this URL as a durable note” rather than “quote it inside a conversation”.

## Old terms you may still see

Older code and docs still use some legacy terms.

Preferred current mapping:

- **page** → doc
- **node** → doc or project, depending on context
- **tracked page** → project
- **memory note** → normal doc in `<vault-root>`

When in doubt, think in terms of doc, skill, project, and instruction file.

## Practical rules

- if it should be remembered outside the current task, write it into `<vault-root>`
- if it is procedural, make it a skill
- if it is behavior or policy, make it an instruction file
- if it needs structured progress state, make it a project
- do not treat old chat history as the canonical durable store

## Related docs

- [Conversation Context](./conversation-context.md)
- [Conversations](./conversations.md)
- [Projects](./projects.md)
- [Configuration](./configuration.md)
