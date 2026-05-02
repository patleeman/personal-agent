---
id: skills-and-capabilities
kind: internal-skill
title: Skills and Runtime Capabilities
summary: Built-in guidance for distinguishing reusable workflow skills from runtime features and extensions.
---

# Skills and Runtime Capabilities

Use this doc when you need to decide whether something should be a skill, a doc, an instruction file, or an extension.

## Fast split

- **instruction file** — standing behavior and policy
- **doc** — reusable knowledge
- **skill** — reusable workflow
- **extension** — runtime behavior implemented in code

## Skills

Skills are reusable workflow packages.

Shared contract:

```text
<vault-root>/skills/<skill>/SKILL.md
```

Use a skill when you want:

- a named repeatable workflow
- reusable procedural guidance
- supporting files bundled with the workflow

## Extensions

Extensions change what the runtime can do.

Examples in this repo:

- `knowledge-base`
- `web-tools`
- `daemon-run-orchestration-prompt`
- `openai-native-compaction`
- `gpt-apply-patch`

Use an extension when the change requires code and runtime integration, not just new instructions.

## What to edit when you want to change behavior

- change `AGENTS.md` or selected instruction files for policy and standing behavior
- add or edit a doc for reusable knowledge
- add or edit a skill for reusable workflow
- add or edit an extension when the runtime itself needs new behavior

## Practical rule

If markdown is enough, do not start with an extension.

Reach for an extension only when you need new tools, UI, event handling, runtime hooks, or permission behavior.

## Related docs

- [Knowledge System](../../docs/knowledge-system.md)
- [Decision Guide](../../docs/decision-guide.md)
- [Command-Line Guide (`pa`)](../../docs/command-line.md)
- [Web UI Guide](../../docs/web-ui.md)
