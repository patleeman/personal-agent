# How personal-agent works

`personal-agent` is a durable application layer around Pi.

The main idea is simple:

- keep shared defaults in the repo
- keep durable knowledge in an external vault
- keep machine-local runtime state under `~/.local/state/personal-agent`
- use the smallest correct durable surface for each job

If you want the fastest routing layer first, read [Decision Guide](./decision-guide.md).

## The three places state can live

### 1. Repo-managed defaults

These ship with the repo and are shared through git:

- `defaults/agent`
- `extensions/`
- `themes/`
- `internal-skills/`
- `prompt-catalog/`

### 2. Durable knowledge vault

By default, durable knowledge lives at:

```text
~/Documents/personal-agent/
```

That vault holds:

- `AGENTS.md`
- `skills/<skill>/SKILL.md`
- `notes/**`
- `projects/**`

This is the canonical home for durable knowledge, procedures, tracked work, and shared instruction files.

### 3. Machine-local runtime state

Machine-local state defaults to:

```text
~/.local/state/personal-agent/
```

Common pieces:

- `config/config.json` — machine config, selected default profile, web UI prefs, vault override
- `daemon/` — daemon socket, log, runtime DB, durable runs
- `web/` — remote browser pairing state and web runtime state
- `desktop/` — Electron desktop config and logs
- `sync/{_tasks|tasks}/` — scheduled task files

This state is durable on one machine, but it is not the portable vault.

## How a session starts

When you start Pi through `pa`, `personal-agent` resolves layered runtime resources:

1. repo defaults from `defaults/agent`
2. vault root `AGENTS.md`, vault skills, and any machine-selected `instructionFiles` / `skillDirs`
3. machine-local overlay from `~/.local/state/personal-agent/config/local`
4. built-in repo extensions/themes and any discovered package sources

Those layers are materialized into the runtime that Pi actually sees.

## Durable surfaces

| Surface | Purpose | Durable home |
| --- | --- | --- |
| Conversation | active work right now | session state |
| Note page | reusable knowledge | vault `notes/` |
| Skill page | reusable procedure | vault `_skills/` |
| Tracked page | ongoing work | vault `projects/` |
| Conversation attention | async follow-up on an owned thread | conversation attention state + linked records |
| Reminder / alert | stronger tell-me-later delivery | machine-local alert/wakeup state |
| Deferred resume | wake this conversation later | machine-local wakeup state |
| Run | detached work started now | daemon runtime DB + `daemon/runs/` |
| Scheduled task | later/recurring automation | machine-local `sync/{_tasks|tasks}/` |
| Conversation artifact | rendered thread-local output | conversation artifact state |

## Interfaces on top of the same model

### CLI

`pa` launches Pi and manages the durable surfaces around it.

### Web UI

The web UI is the main day-to-day operator surface. It exposes conversations, automations, settings, and optional remote browser access when served over the tailnet.

### Electron desktop shell

The desktop app wraps the web UI, owns a local backend while it is running, and can switch to saved web or SSH hosts.

### Daemon

The daemon provides scheduled tasks, deferred resumes, and daemon-backed durable runs.

## Rules that keep the system coherent

- conversations are for execution, not long-term storage
- durable knowledge belongs in the vault
- scheduled task files stay machine-local
- durable behavior belongs in `AGENTS.md` and machine-selected instruction files, not in random notes
- machine-selected extra skill folders belong in `skillDirs`, not mixed into unrelated config
- if a feature needs later attention, attach it to the owning conversation, automation, reminder, deferred resume, run, or scheduled task explicitly

## Related docs

- [Decision Guide](./decision-guide.md)
- [Knowledge Management System](./knowledge-system.md)
- [Configuration](./configuration.md)
- [Conversations](./conversations.md)
- [Web UI Guide](./web-ui.md)
