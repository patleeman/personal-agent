# Web UI Guide

The web UI is the easiest way to work with `personal-agent` day to day.

It gives you one place to see:

- inbox attention
- conversations
- docs, projects, and skills
- scheduled tasks
- daemon state
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
- disabling it via `--no-tailscale-serve` stores the preference immediately and then makes a best-effort attempt to remove the desktop root mapping and the `/app` companion mapping.

If the `tailscale` CLI is unavailable (or the node is not authenticated), enabling Serve still returns an error immediately. Foreground `--no-tailscale-serve` warns but still launches the local UI so the machine-local workflow is not blocked.
If the configured companion port is already in use, foreground launch picks a temporary free companion port for that session.

In practice:

- `https://<tailnet-host>/` → full desktop web UI
- `https://<tailnet-host>/app` → paired mobile companion

For app-level access control on remote devices:

- generate a short-lived pairing code from the local desktop web UI or `pa ui pairing-code`
- enter it once on the remote desktop browser or companion app
- the desktop web UI is the admin surface for pairing and revocation; the companion surface only exchanges codes into sessions
- active paired browsers and devices refresh their session while in use; idle pairings expire after 30 days unless you revoke them sooner
- the companion chats view mirrors desktop workspace-open conversations separately from live-but-not-open and needs-review conversations, so mobile archive/open actions track the same shared layout
- the companion docs browser uses the same row shell as inbox and chats, and supports the same Lucene-style durable-doc querying model as the desktop docs browser in a mobile-first layout
- companion setup/recovery actions such as install, notification enablement, and manual refresh are surfaced directly in the chats view for quicker mobile recovery

Note: `tailscale serve` is tailnet-only by default. Use [Funnel](https://tailscale.com/kb/1223/funnel/) only when you explicitly want public internet access.

The web app uses the current active profile.

The managed service is the recommended way to run the UI when you want it to be your main interface.
It survives terminal closes, restarts automatically, and can be restarted by `pa update`.
When installed, updates use blue/green staging: the next release is built into the inactive slot, health-checked on a candidate port, then swapped in.

The UI has a dedicated **System** page for:

- consolidated daemon and managed web UI status
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
- project management backed by `state.yaml`
- visibility into daemon and web UI state
- a visual notes browser
- live updates without polling

## Main sections

### Notifications

The Notifications page shows:

- standalone inbox activity
- archived conversations that need attention
- reminder and callback notifications inline with the same list

Typical examples:

- scheduled task output
- deferred resume activity
- background failures
- conversations resurfaced by linked background work
- reminders
- approval-needed wakeups
- scheduled-task callbacks linked back to a conversation

Reminder and callback notifications stay in the main inbox list and can expose per-row actions such as open, mark read, dismiss, and snooze.

See [Reminders and Notification Delivery](./alerts.md).

In the desktop UI, Notifications lives near the bottom of the left sidebar above Settings.

You can:

- filter unread vs all
- mark everything read
- clear surfaced notifications (deletes standalone activity and marks archived attention conversations read)
- open individual items or conversations

See [Inbox and Activity](./inbox.md).

### Conversations

Conversations are where live work happens.

The UI supports:

- live sessions
- resumed sessions from saved history
- message streaming
- conversation forks
- summary forks
- branch navigation
- context usage display
- file/image input
- rich markdown rendering in conversation messages

A new draft conversation becomes a live session when you send the first prompt. The UI keeps the queued user turn visible and shows a pending status immediately, even while the live session is still being created or its first SSE snapshot is loading. The first prompt is dispatched as soon as the live session exists instead of waiting for the new conversation page to stay mounted through its initial SSE bootstrap, so clicking away should not stall that first turn. When you switch to another saved conversation, the current transcript stays visible and the panel shows an inline `Loading new messages…` indicator until the next conversation history is ready. Scroll reset waits for the replacement transcript instead of re-running against the preserved old one, so the panel should not yank the visible transcript around during that handoff.

If a deferred resume or reminder becomes ready while you already have that saved conversation open in the web UI, the page auto-resumes it and delivers the deferred prompt without requiring a manual `continue now` click when that wakeup allows auto-resume.

Saved conversations show these queued and ready items under **Wakeups**. From that row, you can fire a wakeup immediately or cancel it.

Conversation unread state only drives per-thread “needs review” markers. Detached background run review stays on the Runs page instead of adding workspace-wide conversation badges.

Conversation lists in the sidebar live under a dedicated **Threads** section and are grouped by working directory so related threads stay clustered under the same repo or folder. The sidebar keeps those working-directory sections and open-conversation tabs in their existing layout order instead of re-sorting them by recent activity. Closing the active open tab moves you to the next remaining visible tab in that order; if none remain, the UI falls back to the new-conversation route. Each working-directory header shows a folder icon, reveals the full path on hover, turns into a collapse/expand affordance on hover, and lets you collapse that cwd group by clicking the row; the separate trailing action still starts a draft chat in that cwd. Sidebar conversation rows use compact left-edge status markers instead of inline text: a spinner while the agent is still running and a small dot when the conversation needs review. Live title changes propagate into those sidebar rows immediately, so auto-titles and manual renames do not lag behind the open conversation header.

Saved conversations keep a minimal right-hand inspector focused on runs and details. That rail stays closed by default and opens on demand. In the runs section, conversation work, background work, and thread-mentioned work are grouped separately so the source of each item is clearer than a flat internal run list.

The conversation header stays compact: it keeps the title and inline working-directory controls together, and both draft and saved conversations can change that cwd from the same header area without opening the right rail. Saved-conversation status stays out of the title bar; live/running and needs-review signals are handled elsewhere in the UI instead of next to the title. Saved conversations expose a summarize + fork icon button on the right side of the top bar beside the inspector toggle, separated from the title/cwd controls, so the branch action stays available without crowding the main header text. That action duplicates the thread, compacts the duplicate, and opens that summarized copy as a new conversation. The transcript and composer stay within a centered max width for readability, while conversation-local runtime controls like model, thinking level, context usage, branch, and git line summaries live in or directly under the composer instead of the header.

Conversation artifacts can appear as chat stubs and open in the right-hand artifact panel for rendered HTML, Mermaid, and LaTeX outputs.

Live-conversation control is tracked per connected surface. The desktop web UI and the `/app` companion can mirror the same live session, but desktop SSE connections do not depend on companion auth state unless the request is actually coming through the companion `/app` API surface.

When browser notifications are already enabled, reminder/callback notifications can still interrupt while the tab is hidden.

When the list finishes, the agent does one final review pass and can add more todo items through the todo-list tool before stopping.


### Files and the vault

The default landing view is a new conversation at `/conversations/new`.

The desktop web UI no longer includes a dedicated Vault/workspace file browser. Use your normal editor or file manager for raw file work, and use the web UI for conversations, automation, inbox, and durable app state.

The app still keeps working-directory selection where it matters for conversations and automation setup.

See [Workspace](./workspace.md).


Each preset is a named ordered todo list of skill items.
You can:

- create presets
- reorder or remove todo items
- mark presets as defaults for new conversations
- apply presets into a live conversation



### Docs (`/pages`)

The Docs page is the shared browser for notes, projects, and skills.

It is meant to make the durable layer feel like one surface with a normal table-first browse flow instead of three unrelated product areas.

From the Docs page you can:

- browse notes, projects, and skills together in one table
- use a Lucene-style query bar for tag and text search, with inline field insertion and field-name suggestions while typing
- sort by updated/created/title/status and keep one shared table while grouping inline by kind or tag-derived dimensions
- filter by date range without leaving the page
- switch the browser between built-in views (all / notes / projects / skills) or saved server-backed views from one selector
- save reusable browser views on the server so they follow the active profile instead of the current browser tab
- keep the table in either a roomier or denser row layout
- start from one unified new-doc screen that can create notes, projects, or skills
- use compact per-row icon actions to open a doc in the shared workspace or delete supported doc types directly from the table
- open any row into one shared doc workspace with the main content in the center and metadata on the right
- let that workspace adapt to the doc role instead of switching to unrelated top-level product areas
- edit shared doc metadata there, including title/summary/description where appropriate, status, parent, and structured `key:value` tags with separate key/value inputs
- keep recently opened docs and skills together in the sidebar’s unified Open Docs shelf
- keep doc bodies, skill definition/reference files, and tracked project documents on the same shared markdown editor surface instead of three unrelated editors
- use `/pages` as the canonical browser URL for durable doc and skill workspaces

### Tracked page workspaces

Tracked pages are durable cross-conversation work hubs, and in the UI they open directly inside `/pages`.

From a tracked page workspace you can:

- inspect current status, blockers, optional milestones, and tasks
- edit the raw tracked-page source (`project.md` frontmatter + markdown body)
- edit or regenerate the tracked-page document when present
- create child pages under the current page
- upload attachments and page artifacts
- see linked conversations for the page
- start a new conversation directly from the page
- view a combined page timeline

See [Tracked Pages](./projects.md) and [Artifacts and Rendered Outputs](./artifacts.md).

### Automations

The Automations page is the UI for daemon-managed scheduled prompts.

It is a dedicated top-level page in the main nav rather than a Settings subpage, so the task list can use the full center pane while the detail rail stays on the right.

Automations are still passive by default. If an automation is explicitly bound back to a conversation, the result can also surface later as an inbox notification and conversation wakeup.

You can:

- see discovered automations
- see current status and recent runs
- create a new automation from the page header / detail rail flow
- enable or disable an automation
- edit automation settings and prompt from the detail rail
- use a simple recurring-schedule builder for common cron patterns, with raw cron still available when needed
- run an automation immediately

See [Scheduled Tasks](./scheduled-tasks.md).

### System

The System page consolidates the status surfaces for the daemon and managed web UI.

It gives you one place to:

- check whether each service is healthy and running
- inspect recent log tails for each subsystem
- run per-subsystem actions directly from the page (restart Web UI or daemon)
- jump into the advanced Daemon or Web UI pages when you need deeper controls
- run **Update + restart** (`pa update`) or **Restart everything** (`pa restart --rebuild`) for the managed application

The advanced pages still exist for subsystem-specific setup and controls:

- **Daemon** — managed daemon service controls, runtime status, and daemon logs
- **Web UI** — tailscale, blue/green release state, rollback, mark-bad, and advanced web UI service controls

See [Daemon and Background Automation](./daemon.md).

### Doc workspaces

Docs also open inside `/pages`.

Use a doc workspace when you want doc editing or durable page work that is still running or needs attention.

Use `/pages` for durable doc work. Old note/project browser URLs are no longer part of the intended product surface.

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
- knowledge vault root
- saved UI state

Settings is now one stacked page instead of separate preference and system subpages.

It keeps defaults, appearance, providers, interface reset tools, workspace info, and system controls together in a single column with simple dividers instead of nested boxes.

The Instructions page follows the same pattern: a stacked source picker and a full-width editor in the center, while the right rail carries source metadata and rendered instruction preview.

Switching the active profile affects:

- inbox
- tracked pages
- the AGENTS/skills lens used around pages
- new live sessions

## Prompt references in conversations

The composer supports `@` references.

You can reference:

- note pages
- scheduled tasks
- files in the knowledge vault (for example `@_profiles/datadog/AGENTS.md`)

When you mention these items, the UI resolves them and injects durable context into the live session.

The composer shows the top 12 mention matches at a time; keep typing to narrow the list when the vault is large.

Skills and profile behavior are no longer separate `@` mention targets; reference the underlying vault files directly when you want that exact file in play.

## Working directory selection

A new conversation uses an explicitly selected working directory when one is set.

The draft page keeps that picker inline in the header next to the title, so starting in the right repo is fast without opening a right-side inspector. Saved conversations expose the same top-bar area for switching into a different repo or folder later.

Otherwise, the web UI falls back to the saved default cwd from Settings, or the web server process cwd when no default is saved.

## Conversation UI Layout

The conversation page uses a Codex-inspired layout for a cleaner, more focused interface.

### Header

The conversation header is compact, showing:
- **Title** on the left
- **Working directory** next to the title (if set)
- **Inline working-directory controls** in the header for both new and saved conversations
- **Clickable title** to rename existing conversations
- **Right-rail toggle** on saved conversations (closed by default)

### Composer Area

The input/composer area features:

- **Subtle + button** for attaching files or images
- **Drawing button** immediately to the right of attachments
- **Text input** in the center
- **Model and thinking selectors** styled as compact runtime controls under the input
- **Context usage** displayed below the input on the left side
- **Branch and git summaries** shown below the input on the right side for existing conversations

### Send Button

The send button is a circular up-arrow that:
- Appears when there's content in the composer
- Is disabled (grayed out) when the composer is empty
- Stays available while the agent is running as a queued **steer** / **followup** action beside the stop button

### Running State

When the agent is streaming:
- A pulsing dot indicator appears in the header
- A queued-send button appears beside the stop button
- Holding Alt switches that queued-send action from **steer** to **followup**
- Alt+Enter can still be used to queue a follow-up prompt while the agent is running

## Common conversation composer commands

The UI supports slash-style commands in the composer.

Common ones include:

- `/model` — pick a model
- `/page new <title>` — create a page quickly using the same text for both title and description
- `/page reference <id>` — reference a page in this conversation
- `/page unreference <id>` — stop referencing a page
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
- the global app stream carries lightweight summary state, and the server-side `/api/sessions` snapshot now merges live controller state before it reaches the browser; heavier durable run history and conversation transcript data still load on demand from their own surfaces
- conversation bootstrap requests reuse cached transcript windows by session-file signature when possible, and the browser keeps recent transcript windows in durable local cache so reopen/reload usually only fetches lightweight live metadata unless that transcript actually changed
- when a saved conversation transcript only grew at the tail, the UI refresh path now requests just the appended blocks and merges them into the cached window instead of redownloading the whole tail slice
- opening a saved conversation now starts from a smaller tail window so thread switches paint faster, while older history backfills lazily in the background or on demand
- open conversation tabs are prewarmed in the background so switching between already-open threads usually reuses hot transcript and live-session state instead of starting from cold
- open conversation pages now derive their transcript refresh version from conversation file changes instead of metadata-only churn, so running-state updates do not force needless transcript bootstrap refetches
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
- [MCP](./mcp.md)
- [Inbox and Activity](./inbox.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Daemon and Background Automation](./daemon.md)
