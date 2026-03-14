# Skills and Runtime Capabilities

This page explains the user-facing difference between **skills** and **extensions**.

Most users and agents should think about them this way:

- **skills** are reusable workflows
- **extensions** are runtime behaviors that change what the agent can do

## Skills vs extensions

| Feature | What it is | How to think about it |
| --- | --- | --- |
| Skill | named workflow with instructions and supporting files | reusable capability the agent can call on |
| Extension | code that changes runtime behavior | a built-in or profile-provided feature of the agent runtime |

## Skills

Skills live in layered profile directories such as:

- `profiles/shared/agent/skills/`
- `~/.local/state/personal-agent/profiles/<profile>/agent/skills/`
- local overlay skill dirs
- repo/package-provided internal skills such as `skills/`

A skill is the right place for:

- repeatable workflows
- domain-specific procedures
- operational runbooks with commands or helper scripts

Examples in this repo include:

- scheduled task workflows
- browser automation helpers
- morning report workflows
- repo and coding best-practice workflows
- the internal `pa-project-hub` workflow for durable project editing

Skills are surfaced in user-facing places like:

- the Memory page in the web UI
- gateway skill shortcuts such as Telegram `/skill:<name>`
- the agent's normal resource loading when a profile is active

## Extensions

Extensions add runtime behavior.

Most of the time, you use them indirectly rather than thinking about their source code.

Examples of user-visible extension behavior in this repo:

- **memory** — keeps AGENTS, skills, and memory rules visible to the agent
- **web-tools** — gives the agent web search/fetch capability
- **daemon-run orchestration prompt** — gives the agent better policy for daemon-backed durable background work
- **project agent extension** — manages current conversation ↔ project references

## What to edit when you want to change behavior

Use this rule:

- change `AGENTS.md` when you want to change durable behavior or policy
- add or update a **skill** when you want a reusable workflow
- add a **memory doc** when you want durable knowledge or reference material
- create or update a **project** when you want tracked execution state
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

- Memory page shows skills and durable knowledge
- conversations can reference skills with `@`
- live sessions use the active profile's runtime behavior

### Gateway

- Telegram exposes skill commands and slash shortcuts
- background completions and notifications can be routed back into chat

### CLI / TUI

- `pa tui` launches Pi with the resolved layered resources
- the active profile controls which skills and extensions are available

## Related docs

- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [How personal-agent works](./how-it-works.md)
- [Web UI Guide](./web-ui.md)
- [Gateway Guide](./gateway.md)
