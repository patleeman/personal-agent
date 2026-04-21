# Web UI Guide

The web UI is the main day-to-day surface for `personal-agent`.

It exposes the same durable model as the CLI, but with live updates, conversation management, automations, and settings in one place.

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

- **Conversations** — draft, saved, open, pinned, archived, and live thread work
- **Automations** — scheduled tasks and task detail/editing
- **Settings** — appearance, general defaults, providers, SSH remotes, and interface reset tools

A few older routes now redirect instead of acting as first-class destinations:

- `/system`, `/tools`, and `/instructions` redirect to **Settings**
- `/tasks`, `/scheduled`, and `/runs` redirect to **Automations**
- `/knowledge`, `/notes`, `/skills`, and `/nodes` redirect away from the old knowledge browser concept

## Conversations

The conversation experience is still the center of the UI.

Important behaviors:

- draft conversation state is durable in the browser UI
- multiple saved conversations can stay open or pinned at once
- the Threads sidebar keeps conversation rows to a single line, with the relative timestamp in the trailing slot by default and only lightweight row chrome on hover
- saved workspaces stay visible in the Threads sidebar even when they do not currently have any open threads, and project-grouped workspaces keep that saved/open order instead of being reshuffled by thread activity
- auto-generated conversation titles are tuned for that narrow single-line Threads layout and default to the dedicated title model `openai-codex/gpt-5.4-mini` unless you pin another title model in Settings
- the Threads header includes a filter action for organize/sort controls and an add-workspace action that opens a quick-select modal for saved workspaces, with a fallback to choose a new folder and seed a new draft conversation in that cwd; project and chronological views use created-time sorting by default unless you switch them to updated, and there is also a manual order mode that drag-and-drop switches to automatically for both individual threads and whole workspace sections in project view
- the Threads sidebar exposes per-conversation actions from a row-level right-click menu instead of the main header, including pin-to-top, archive, duplicate, summarize and open new, and copy actions for the working directory, session ID, and deeplink
- selected transcript text now uses a context menu for reply and copy actions instead of inline buttons, and replying with a selection appends the quoted text to the current composer draft
- the composer understands Pi-style whole-line bash shortcuts: `!command` runs bash and keeps the output in conversation context, while `!!command` runs bash without adding the output to LLM context
- the desktop shell keeps open conversation tabs warm by prefetching transcript bootstrap state and keeping background live threads subscribed, so switching tabs can reuse hot cache instead of cold-loading the thread again
- the Threads command palette keeps loading older saved conversations as you scroll, so history stays out of the main sidebar
- live threads update over SSE in browser mode and over the desktop event transport in local Electron mode
- `Cmd/Ctrl+F` opens an in-app page search bar for the current surface, with `Enter` / `Shift+Enter` and `Cmd/Ctrl+G` / `Cmd/Ctrl+Shift+G` stepping through matches
- conversation artifacts open inline in the thread workspace
- commit checkpoints can show up as transcript cards with a scrollable inline unified diff peek that expands in place, then open a larger dedicated diff review modal from the conversation with continuous scrolling across files, responsive sizing, sidebar jump navigation, split / unified views, bundled structural diffs in the desktop build, GitHub / PR links, and a saved comment thread on the checkpoint; inline commit hashes in transcript markdown also open that review flow when they resolve against the thread checkpoint list or the current local git repo
- the new-conversation empty state owns the draft workspace picker, including saved workspace selection and folder picking, and it shows the 10 most recent closed conversations under the picker so a fresh window still has quick context reuse; the draft header stays title-only
- saved conversation headers keep the top bar title-only; working directory still stays attached to the conversation instead of rendering inline there
- the composer footer keeps execution target + working directory controls on the left and git/context status on the right; saved threads can edit cwd inline and browse for a new folder before switching
- the desktop composer can capture a macOS screenshot inline via the native screenshot UI and attach the resulting PNG directly to the current prompt
- project-organized thread lists group by execution target first and workspace second, with local groups left implicit and remote targets rendered as their own section headers
- the Threads filter can switch between all threads, human threads, and automation-owned threads, and automation-owned threads show an inline automation badge in the sidebar
- working directory and model preferences stay attached to the conversation
- file/doc mentions already work through `@` in the composer for one-shot context
- the conversation model is moving toward a lightweight attached-doc shelf above the composer for persistent KB context across turns
- desktop and remote browser sessions can watch the same live conversation
- linked durable runs in transcript internal-work clusters stay collapsed by default, and their inline log polling only starts once you expand a specific run card

## Async attention

There is no Inbox route anymore.

Async state now lives on the owning surface:

- conversation-linked work shows up in the thread and conversation attention state
- automation-linked work shows up on the automation detail page and its owning thread
- alert delivery remains separate from durable ownership and can point back into those surfaces

## Automations

The **Automations** route is the durable scheduling workspace.

The overview is intentionally lean: a simple header plus two sections — **Jobs** for scheduled background-agent prompts and **Threads** for conversations currently attached to automations.

Current capabilities:

- create new automations in-app
- edit existing automation definitions
- choose whether an automation targets a background job or a conversation thread
- choose whether an automation uses a dedicated thread, an existing thread, or no thread when that target allows it
- open the automation-owned thread directly from the detail view
- choose a per-automation catch-up window so missed cron runs can fire once after wake instead of being dropped
- enable / disable automations
- delete automations with an in-app confirmation step
- run an automation immediately, jump into its owning thread, and keep that thread surfaced in Threads while the automation is running
- inspect recent automation-owned run history directly from the automation detail view
- review missed schedule events and catch-up decisions in the automation Activity section instead of hunting through daemon logs

Time-based `conversation_queue` entries and scheduled `run.start_agent` prompts now land here as saved automations. Transient `after_turn` queue entries still stay conversation-local and do not appear in Automations.

## Settings

The **Settings** route now carries most of what used to be spread across separate admin pages.

It is also the fallback destination for the removed standalone **Tools** and **Instructions** pages.

The page is now organized as one long settings document with a centered intro and a sticky table of contents on the right side.

It is also the place to manage local instruction-file selection and other runtime defaults.

Model defaults in Settings now expose a **Fast mode** toggle (maps to `service_tier=priority` when supported by the selected model) instead of the old generic service-tier dropdown.

The top-level section order is:

- appearance
- general defaults
- providers and provider auth
- desktop connections when running inside Electron
- interface reset tools

The current layout keeps those top-level sections visually distinct with spacing and dividers instead of wrapping each section in another large card, while the sticky right-side table of contents mirrors only the sections that are actually present in the current shell.

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
- alerts
- tasks
- durable runs
- daemon health
- web UI state

In browser mode those updates arrive over SSE. In local Electron mode, app bootstrap and hot app-state updates now go through a dedicated desktop bridge capability, while the remaining stream-heavy surfaces bridge through the Electron main process. If live transport is temporarily offline, the UI falls back to snapshot refreshes when it can.

Route-level lazy chunks also self-heal once when the app is holding a stale bundle reference after a local rebuild or desktop asset swap. Instead of leaving the operator on a render-error screen, the UI performs a single reload and then retries with the fresh asset manifest.

## Electron desktop shell integration

When the UI runs inside the Electron shell it gains desktop-specific chrome and actions:

- host indicator
- connection management
- back/forward integration
- host switching
- opening saved remote hosts in dedicated windows

The application data model is still the same web UI. Electron windows now always load the packaged renderer over `personal-agent://app/`: local hosts resolve hot local API/event flows through the Electron main process, while remote hosts forward `/api/*` requests and streams through an app-server WebSocket owned by Electron main.

## What the web UI does not try to be

The desktop web UI no longer includes a general file browser, tracked-page browser, or standalone runs/tools/instructions workspace.

Use your editor for repo files and durable instruction sources, and use the vault directly for broad note/skill/project work.

## Related docs

- [Conversations](./conversations.md)
- [Workspace](./workspace.md)
- [iOS host-connected app design](./ios-host-app-plan.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
- [Runs](../internal-skills/runs/INDEX.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
