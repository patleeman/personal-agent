# Knowledge System

The knowledge system manages durable content that shapes agent behavior and provides reusable reference material. It lives under `<vault-root>`.

## Vault

The vault is the root directory for all durable knowledge. It resolves in this order:

1. `PERSONAL_AGENT_VAULT_ROOT` environment variable
2. Managed KB mirror at `<state-root>/knowledge-base/repo` (when `knowledgeBaseRepoUrl` is configured)
3. Legacy `vaultRoot` config value in `<config-root>/config.json`
4. `~/Documents/personal-agent`

## Vault Contents

### Instruction files

Markdown files that define standing behavior and policy for the agent. These are not just reference material — they actively shape how the agent responds.

Selected in Settings or listed in config.json:

```json
{
  "instructionFiles": ["instructions/base.md", "instructions/code-style.md"]
}
```

Machine-local instruction files live under the config root and can be selected in Settings.

### Docs

Reusable reference material stored as markdown files anywhere under `<vault-root>`. Docs are facts the agent reads when needed — API references, architecture decisions, onboarding guides.

### Skills

Reusable workflows defined as markdown with a standard structure:

```
<vault-root>/skills/<skill-name>/
├── SKILL.md       # Main skill definition
├── examples/      # Optional supporting files
└── assets/        # Optional images or data
```

Skills are loaded by the runtime and available to the agent through skill commands. Each skill is a self-contained procedure the agent can follow.

Skill metadata is reference-only. Runtime skill discovery loads every valid skill under `<vault-root>/skills`; do not hide or reveal skills through runtime scopes.

### Projects

Structured work packages with milestones, tasks, and durable status. See [Projects](projects.md).

## AGENTS.md Layering

AGENTS.md files are auto-discovered by Pi from the working directory and its parents. They are assembled into the system prompt as a "Project Context" section. The canonical locations, in load order:

1. **Agent dir** — `<state-root>/pi-agent-runtime/AGENTS.md` (materialized from vault and local layers)
2. **CWD up to root** — `AGENTS.md` or `CLAUDE.md` from the current directory and each parent

Duplicates are skipped — the first file with a given absolute path wins.

## System Prompt Assembly

The final system prompt is assembled exclusively from file-based layers, in order:

1. **`SYSTEM.md`** in the agent dir — base system prompt (rarely used)
2. **`APPEND_SYSTEM.md`** in the agent dir — generated at startup with live paths and available skills
3. **AGENTS.md files** from CWD walking up — appended as "Project Context"
4. **Skills** — appended as available skill references
5. **Date and working directory** — appended last by Pi

Extensions cannot modify the system prompt at runtime. Any extension that returns `{ systemPrompt }` from `before_agent_start` is silently discarded by a guard in `profileState.ts`. To influence the system prompt, write content to one of the file-based layers above.

## Loading Order

When assembling the runtime context, knowledge merges in this order. Later sources override earlier ones for conflicting keys:

1. Repo-managed defaults (`extensions/`, `internal-skills/`, `prompt-catalog/`, `docs/`)
2. Selected instruction files
3. Skill directories under vault
4. Vault docs

## Agent Interaction

The agent reads from the vault using file tools. It can browse, read, and reference vault content during conversations. The desktop Knowledge Editor provides a UI for browsing and editing vault files. See [Knowledge Editor](knowledge-editor.md).

## Related

- [Knowledge Base Sync](knowledge-base-sync.md) — git-backed vault synchronization
- [Projects](projects.md) — structured work packages in the vault
- [Configuration](configuration.md) — vault root and instruction file settings
