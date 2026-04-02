# Web UI Guide

The web UI is the easiest way to work with `personal-agent` day to day.

It gives you one place to see:

- inbox attention
- conversations
- workspace files and edits
- projects
- scheduled tasks
- sync state
- daemon state
- notes
- profile and model settings

## Start the UI

Foreground mode:

```bash
pa ui
pa ui --open
pa ui --port 4000
pa ui --tailscale-serve
```

Managed service mode for day-to-day use:

```bash
pa ui service install [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]
```

Default address (local interface):

- `http://localhost:3741`

If the managed web UI service is already installed, running, and listening on the requested port, `pa ui` reuses it instead of trying to start a second foreground server on the same port.
That avoids duplicate-launch failures like `EADDRINUSE` and makes `pa ui --open` a safe way to jump back into the UI.

## Expose with Tailscale Serve

You can expose the running web UI to your Tailnet via Tailscale Serve.
The UI and `pa ui` config persist this preference in the `webUi` section of `~/.local/state/personal-agent/config/config.json` as:

```json
{
  "webUi": {
    "useTailscaleServe": true,
    "port": 3741,
    "companionPort": 3742
  }
}
```

This means:

- web UI launch and managed service actions read the preference consistently,
- the Web UI page shows and toggles the setting,
- enabling it in the UI or via `--tailscale-serve` exposes the full desktop UI at the Tailnet root (`/`) and the mobile companion at `/app`,
- disabling it via `--no-tailscale-serve` removes both the desktop root mapping and the `/app` companion mapping.

If the `tailscale` CLI is unavailable (or the node is not authenticated), the toggle/flag returns an error so the mismatch is visible immediately.

In practice:

- `https://<tailnet-host>/` → full desktop web UI
- `https://<tailnet-host>/app` → paired mobile companion

For app-level access control on remote devices:

- generate a short-lived pairing code from the local desktop web UI or `pa ui pairing-code`
- enter it once on the remote desktop browser or companion app
- the desktop web UI is the admin surface for pairing and revocation; the companion surface only exchanges codes into sessions
- active paired browsers and devices refresh their session while in use; idle pairings expire after 30 days unless you revoke them sooner
- the companion chats view mirrors desktop workspace-open conversations separately from live-but-not-open and needs-review conversations, so mobile archive/open actions track the same shared layout
- the companion pages browser uses the same row shell as inbox and chats, and now supports the same Lucene-style page querying model as the desktop pages browser in a mobile-first layout
- companion setup/recovery actions such as install, notification enablement, and manual refresh are surfaced directly in the chats view for quicker mobile recovery

Note: `tailscale serve` is tailnet-only by default. Use [Funnel](https://tailscale.com/kb/1223/funnel/) only when you explicitly want public internet access.

The web app uses the current active profile.

The managed service is the recommended way to run the UI when you want it to be your main interface.
It survives terminal closes, restarts automatically, and can be restarted by `pa update`.
When installed, updates use blue/green staging: the next release is built into the inactive slot, health-checked on a candidate port, then swapped in.

The UI has a dedicated **System** page for:

- consolidated daemon, sync, and managed web UI status
- quick visibility into the processes and background services the app depends on
- `pa restart --rebuild` and `pa update` controls for the full managed application
- recent log tails for each subsystem

It also keeps an advanced **Web UI** page for service-specific controls like tailscale, blue/green release history, rollback, and mark-bad actions.

## Logs

Inspect recent managed web UI logs with:

```bash
pa ui logs
pa ui logs --tail 120
```

Default log location:

- `~/.local/state/personal-agent/web/logs/web.log`

## What the UI is for

Use the UI when you want:

- a persistent inbox
- easy conversation browsing and branching
- a repo-aware workspace browser and editor
- project management backed by `state.yaml`
- visibility into daemon and sync state
- a visual notes browser
- live updates without polling

## Main sections

### Inbox

The Inbox page shows:

- standalone inbox activity
- archived conversations that need attention
- active alerts that still need acknowledgement

Typical examples:

- scheduled task output
- deferred resume activity
- background failures
- conversations resurfaced by linked background work
- reminders
- approval-needed wakeups
- scheduled-task callbacks linked back to a conversation

The UI also shows active disruptive alerts as floating in-app cards so they are harder to miss than inbox items outside the inbox page.

See [Alerts and Reminders](./alerts.md).

You can:

- filter unread vs all
- mark everything read
- clear surfaced inbox items (deletes standalone activity and marks archived attention conversations read)
- open individual items or conversations

See [Inbox and Activity](./inbox.md).

### Conversations

Conversations are where live work happens.

The UI supports:

- live sessions
- resumed sessions from saved history
- message streaming
- conversation forks
- branch navigation
- context usage display
- file/image input

A new draft conversation becomes a live session when you send the first prompt.

If execution targets are configured, the draft conversation empty state lets you choose where the first turn runs before you send it. Once the conversation starts, that execution choice is shown in the header and treated as locked for that conversation.

If a deferred resume or reminder becomes ready while you already have that saved conversation open in the web UI, the page auto-resumes it and delivers the deferred prompt without requiring a manual `continue now` click when that wakeup allows auto-resume.

Saved conversations show these queued and ready items under **Wakeups**. From that row, you can fire a wakeup immediately or cancel it.

The Conversations workspace only treats conversation unread state as “needs review”. Detached background run review stays on the Runs page instead of adding workspace-wide conversation badges.

Saved conversations also keep their working directory, referenced projects, and run context in the same integrated right-hand inspector style used by the shared node workspace, instead of a separate utility sidebar treatment.

Conversation artifacts can appear as chat stubs and open in the right-hand artifact panel for rendered HTML, Mermaid, and LaTeX outputs.

When active alerts exist and browser notifications are still off, the desktop web UI prompts you to enable browser alerts so reminders and callbacks can interrupt even while the tab is hidden.

When the list finishes, the agent does one final review pass and can add more todo items through the todo-list tool before stopping.


### Workspace

The Workspace page is a local file browser and editor for the current codebase.

You can:

- browse a repo-root file tree from the right-hand panel while editing in the main pane
- jump straight to changed files from git status
- inspect a side-by-side word-level diff for the selected file
- open the same workspace in VS Code when you want a fuller editor

When the selected folder lives inside a git repo, the page automatically roots itself at the repo top level so the tree and changed-file list line up with git.

See [Workspace](./workspace.md).



Each preset is a named ordered todo list of skill items.
You can:

- create presets
- reorder or remove todo items
- mark presets as defaults for new conversations
- apply presets into a live conversation



### Pages (`/pages`)

The Pages page is the shared browser for notes, projects, and skills.

It is meant to make the durable layer feel like one surface with a normal table-first browse flow instead of three unrelated product areas.

From the Pages page you can:

- browse notes, projects, and skills together in one table
- use a Lucene-style query bar for tag and text search, with inline field insertion and field-name suggestions while typing
- sort by updated/created/title/status and keep one shared table while grouping inline by kind or tag-derived dimensions
- filter by date range without leaving the page
- switch the browser between built-in views (all / notes / projects / skills) or saved server-backed views from one selector
- save reusable browser views on the server so they follow the active profile instead of the current browser tab
- keep the table in either a roomier or denser row layout
- start from one unified new-page screen that can create notes, projects, or skills
- use compact per-row icon actions to open a page in the shared workspace or delete supported page types directly from the table
- open any row into one shared page workspace with the main content in the center and metadata on the right
- let that workspace adapt to the page role instead of switching to unrelated top-level product areas
- edit shared page metadata there, including title/summary/description where appropriate, status, parent, and structured `key:value` tags with separate key/value inputs
- keep recently opened pages and skills together in the sidebar’s unified Open Pages shelf
- keep page bodies, skill definition/reference files, and tracked-page documents on the same shared markdown editor surface instead of three unrelated editors
- use `/pages` as the only first-class browser URL for page and skill workspaces

### Tracked page workspaces

Tracked pages are durable cross-conversation work hubs, and in the UI they open directly inside `/pages`.

From a tracked page workspace you can:

- inspect current status, blockers, optional milestones, and tasks
- edit the raw tracked-page source (`INDEX.md` frontmatter + markdown body)
- edit or regenerate the tracked-page document when present
- create child pages under the current page
- upload attachments and page artifacts
- see linked conversations for the page
- start a new conversation directly from the page
- view a combined page timeline

See [Tracked Pages](./projects.md) and [Artifacts and Rendered Outputs](./artifacts.md).

### Scheduled

The Scheduled page is the UI for daemon tasks.

Tasks are still passive by default. If a task is explicitly bound back to a conversation, the result can also surface later as an alert and conversation wakeup.

You can:

- see discovered tasks
- see current status and recent runs
- create a new task from the page header / detail rail flow
- enable or disable a task
- edit task settings and prompt from the detail rail
- use a simple recurring-schedule builder for common cron patterns, with raw cron still available when needed
- run a task immediately

See [Scheduled Tasks](./scheduled-tasks.md).

### System

The System page consolidates the status surfaces for the daemon, sync, and managed web UI.

It gives you one place to:

- check whether each service is healthy and running
- inspect recent log tails for each subsystem
- configure execution targets for remote conversation offload
- run per-subsystem actions directly from the page (restart Web UI / daemon, or trigger sync now)
- jump into the advanced Daemon, Sync, or Web UI pages when you need deeper controls
- run **Update + restart** (`pa update`) or **Restart everything** (`pa restart --rebuild`) for the managed application

The advanced pages still exist for subsystem-specific setup and controls:

- **Daemon** — managed daemon service controls, runtime status, and daemon logs
- **Sync** — first-time setup, repo configuration, conflict visibility, and manual sync runs
- **Web UI** — tailscale, blue/green release state, rollback, mark-bad, and advanced web UI service controls

See [Daemon and Background Automation](./daemon.md), [Sync Guide](./sync.md), and [Execution Targets](./execution-targets.md).

### Note workspaces

Note pages also open inside `/pages`.

Use a note page workspace when you want note-specific editing or explicit note-distillation and recovery work that is still running or needs attention.

Use `/pages` for note work. The old note-specific browser URL is no longer part of the intended product surface.

See [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md).

### Tools

The Tools page is the inspection and package-install surface for agent capabilities.

It uses the right-hand detail rail for full inspection views.

You can:

- inspect the tools available to new sessions
- review tool schemas and parameters in the detail rail
- add Pi package sources to any profile or the local overlay
- inspect dependent CLI tools and configured MCP servers

See [MCP](./mcp.md).

### Settings

Settings lets you change:

- browser theme (auto, light, or dark)
- active profile
- default model
- default thinking level
- conversation auto-title behavior and title model
- saved UI state

The settings rail also links out to Runs, Scheduled tasks, Tools, and Instructions for operational work.

Each settings page uses the same basic treatment: one stacked content column with muted section panels and simple dividers instead of nested cards or page-specific box patterns.

The Instructions page follows the same pattern: a stacked source picker and a full-width editor in the center, while the right rail carries source metadata and rendered instruction preview.

Switching the active profile affects:

- inbox
- tracked pages
- the AGENTS/skills lens used around pages
- new live sessions

## Prompt references in conversations

The composer supports `@` references.

You can reference:

- pages
- scheduled tasks
- skills
- profiles

When you mention these items, the UI resolves them and injects durable context into the live session.

This makes the conversation aware of the durable objects you are pointing at, instead of copying them manually into the prompt.

## Referenced projects and working directory selection

Referenced projects matter in two ways:

1. they stay attached to the conversation as durable project context
2. if a new conversation references exactly one project with a `repoRoot`, that repo root can become the initial working directory when no explicit cwd is set

Otherwise, the web UI falls back to the saved default cwd from Settings, or the web server process cwd when no default is saved.

That makes project references more than just labels.

## Common conversation composer commands

The UI supports slash-style commands in the composer.

Common ones include:

- `/model` — pick a model
- `/project new <title>` — create a project quickly using the same text for both title and description
- `/project reference <id>` — reference a project in this conversation
- `/project unreference <id>` — stop referencing a project
- `/resume <delay> [prompt]` — schedule this conversation to continue later (`/defer` also works)
- `/draw` — open the Excalidraw editor and attach a drawing
- `/drawings` — attach an existing saved drawing/revision from this conversation
- `/fork` — fork a conversation branch
- `/compact` — compact context
- `/reload` — reload profile resources
- `/new` — start a new session
- `/tree` — open branch navigation

There are also convenience commands such as `/run`, `/search`, `/summarize`, and `/think`.

## Live updates

The UI uses server-sent events for snapshots and updates.

That means:

- inbox, projects, sessions, tasks, and system status surfaces update live
- you usually do not need to refresh manually
- if the SSE connection drops, the UI will try to reconnect, including during managed web UI restarts

If live updates are offline, refresh buttons remain available on each page.

## Relationship to the CLI

The web UI is not a separate system.

It uses the same underlying state as:

- `pa tui`
- `pa tasks`
- `pa inbox`
- `pa daemon`

So, for example:

- a scheduled task run can create an inbox item visible in the UI
- a project created in the UI is the same durable project the agent can update in a conversation

## Related docs

- [Decision Guide](./decision-guide.md)
- [Conversations](./conversations.md)
- [Async Attention and Wakeups](./async-attention.md)
- [Workspace](./workspace.md)
- [Artifacts and Rendered Outputs](./artifacts.md)
- [How personal-agent works](./how-it-works.md)
- [Tracked Pages](./projects.md)
- [Execution Targets](./execution-targets.md)
- [MCP](./mcp.md)
- [Inbox and Activity](./inbox.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Sync Guide](./sync.md)
- [Daemon and Background Automation](./daemon.md)
