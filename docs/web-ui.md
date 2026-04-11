# Web UI Guide

The web UI is the main day-to-day surface for `personal-agent`.

It exposes the same durable model as the CLI, but with live updates, inbox delivery, conversation management, automations, and settings in one place.

## Start the UI

Foreground mode:

```bash
pa ui foreground
pa ui foreground --open
pa ui foreground --port 4000
pa ui foreground --tailscale-serve
```

Managed service mode:

```bash
pa ui install
pa ui start
pa ui stop
pa ui restart
pa ui status
pa ui logs --tail 120
```

Useful notes:

- `pa ui` with no subcommand shows status instead of launching a server
- default local address is `http://localhost:3741`
- if the managed service is already healthy on the requested port, foreground launch reuses it instead of starting a duplicate server

## Main desktop routes

Current desktop routes/operators surfaces are:

- **Inbox** — notifications, activity, and attention
- **Conversations** — draft, saved, open, pinned, archived, and live thread work
- **Automations** — scheduled tasks and task detail/editing
- **Settings** — appearance, providers, desktop connections, runtime services, workspace info

A few older routes now redirect instead of acting as first-class destinations:

- `/system`, `/tools`, and `/instructions` redirect to **Settings**
- `/tasks`, `/scheduled`, and `/runs` redirect to **Automations**
- `/knowledge`, `/notes`, `/skills`, and `/nodes` redirect away from the old knowledge browser concept

## Conversations

The conversation experience is still the center of the UI.

Important behaviors:

- draft conversation state is durable in the browser UI
- multiple saved conversations can stay open or pinned at once
- the left sidebar keeps current threads at the top and continues into older saved conversation history as you scroll
- live threads update over SSE in browser mode and over the desktop event transport in local Electron mode
- conversation artifacts open inline in the thread workspace
- working directory and model preferences stay attached to the conversation
- desktop and remote browser sessions can watch the same live conversation

## Inbox and notifications

The Inbox route is where async attention lands.

It shows:

- activity items
- conversation attention items

The current UI does not surface alert rows or popup/browser notifications.

## Automations

The **Automations** route is the scheduled-task workspace.

Current capabilities:

- create new automations in-app
- edit existing task definitions
- enable / disable tasks
- run a task immediately and watch the automation state refresh in place

## Settings

The **Settings** route now carries most of what used to be spread across separate admin pages.

It is also the fallback destination for the removed standalone **Tools** and **Instructions** pages.

It includes sections for:

- general defaults
- appearance
- model providers and provider auth
- desktop connections when running inside Electron
- interface reset tools
- runtime services and health
- workspace / vault information

When the web UI is running inside the Electron shell on the local desktop host, the runtime section is framed as the app-owned local runtime rather than as separately managed OS services. When a remote host is active inside Electron, the runtime section still shows that remote host’s daemon and web UI state.

## Remote browser access

## Pairing and Tailscale Serve

When Tailscale Serve is enabled for the web UI, the full browser UI is exposed at the Tailnet root (`/`).

Pairing model:

- generate a short-lived pairing code from the local desktop UI or `pa ui pairing-code`
- codes expire after 10 minutes
- paired remote browser sessions refresh while they are actively used
- idle paired sessions expire after 30 days unless revoked sooner

## Live updates

The web UI relies heavily on push updates.

Live updates include:

- conversation/session changes
- inbox and alerts
- tasks
- durable runs
- daemon health
- web UI state

In browser mode those updates arrive over SSE. In local Electron mode, app bootstrap and hot app-state updates now go through a dedicated desktop bridge capability, while the remaining stream-heavy surfaces bridge through the Electron main process. If live transport is temporarily offline, the UI falls back to snapshot refreshes when it can.

## Electron desktop shell integration

When the UI runs inside the Electron shell it gains desktop-specific chrome and actions:

- host indicator
- connection management
- back/forward integration
- host switching
- opening saved remote hosts in dedicated windows

The application data model is still the same web UI, but local Electron mode now loads the packaged renderer over `personal-agent://app/` and resolves hot local API/event flows through the Electron main process instead of a loopback web server.

## What the web UI does not try to be

The desktop web UI no longer includes a general file browser, tracked-page browser, or standalone runs/tools/instructions workspace.

Use your editor for repo files and durable instruction sources, and use the vault directly for broad note/skill/project work.

## Related docs

- [Conversations](./conversations.md)
- [Workspace](./workspace.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
