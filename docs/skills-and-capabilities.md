# Skills and Runtime Capabilities

This page explains the user-facing difference between **skill nodes** and **extensions**.

Most users and agents should think about them this way:

- **skill nodes** are reusable workflows
- **extensions** are runtime behaviors that change what the agent can do

See [Nodes](./nodes.md) for the canonical node model.

## Skills vs extensions

| Feature | What it is | How to think about it |
| --- | --- | --- |
| Skill node | named workflow with instructions and supporting files | reusable capability the agent can call on |
| Extension | code that changes runtime behavior | a built-in or profile-provided feature of the agent runtime |

## Skill nodes

Skill nodes live in layered durable resource directories such as:

- `~/.local/state/personal-agent/sync/skills/`
- local overlay skill dirs
- repo defaults and built-in runtime capabilities

A skill node is the right place for:

- repeatable workflows
- domain-specific procedures
- operational runbooks with commands or helper scripts

Examples include:

- browser automation helpers
- morning report workflows
- repo and coding best-practice workflows
- deep research and code review workflows

Skill nodes are surfaced in user-facing places like:

- the Notes / knowledge surfaces in the web UI
- the agent's normal resource loading when a profile is active

## Extensions

Extensions add runtime behavior.

Most of the time, you use them indirectly rather than thinking about their source code.

Examples of user-visible extension behavior in this repo:

- **note-node policy** — keeps AGENTS, skills, and note-node rules visible to the agent
- **web-tools** — gives the agent web search/fetch capability
- **daemon-run orchestration prompt** — gives the agent better policy for daemon-backed durable background work
- **project agent extension** — manages durable project nodes and current conversation ↔ project references

## What to edit when you want to change behavior

Use this rule:

- change `AGENTS.md` when you want to change durable behavior or policy
- add or update a **skill node** when you want a reusable workflow
- add or update a **note node** when you want durable knowledge or reference material
- create or update a **project node** when you want tracked work state
- create a **scheduled task** when you want unattended automation

Only reach for extensions when you need to change runtime behavior itself.

## Reloading and availability

Profile resources are loaded when `pa` launches Pi or when the web UI creates a live session.

Useful patterns:

- start a fresh run with `pa tui` or the web UI
- use `/reload` in supported live interfaces when you want runtime resources reloaded

Extension dependencies are auto-installed when needed, so users usually do not need to manage them manually.

## Where these capabilities show up

### Web UI

- note and project surfaces show durable node content
- conversations can reference skills with `@`
- live sessions use the active profile's runtime behavior

### CLI / TUI

- `pa tui` launches Pi with the resolved layered resources
- the active profile controls which skill nodes and extensions are available

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Nodes](./nodes.md)
- [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md)
- [How personal-agent works](./how-it-works.md)
- [Web UI Guide](./web-ui.md)
