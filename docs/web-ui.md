# Web UI Guide

The web UI is the main operator surface.

It exposes the same durable model as the CLI, but with live updates, conversation management, knowledge editing, automation inspection, and settings in one place.

## Start it

Foreground mode:

```bash
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
pa ui logs --tail 120
```

Default local address: `http://localhost:3741`

## Main routes

### Conversations

Primary live-work surface.

Use it for:

- draft and saved conversations
- live streaming turns
- cwd-aware work
- attachments, artifacts, and checkpoints
- queued follow-up work and auto mode
- opening linked runs or automation-owned threads

### Knowledge

Vault editor for files under `<vault-root>`.

Use it for:

- file tree navigation
- persisted folder expansion state
- markdown editing
- frontmatter disclosure and tag editing
- full-text search
- quick-open
- wikilinks and backlinks
- URL import into the vault

### Automations

Current UI route: `/automations`

Use it for:

- scheduled task creation and editing
- choosing background-job vs conversation targets
- enabling or disabling automations
- running an automation immediately
- viewing owned run history and scheduler activity

### Settings

Use it for:

- default profile and default cwd
- instruction file selection
- skill folder selection
- vault root and knowledge-base sync config
- provider auth and model defaults
- desktop host settings when running in Electron

## Live updates

The UI prefers pushed updates.

- browser mode uses SSE
- Electron mode uses the desktop bridge plus event forwarding
- snapshot refresh is only a fallback when live transport is unavailable

Important live topics include conversations, runs, tasks, daemon health, and general app invalidation.

## Remote browser access

If Tailscale Serve is enabled for the web UI, you can expose the app on the tailnet.

Pairing flow:

1. run `pa ui pairing-code`
2. use the short-lived code from the remote browser
3. keep the paired browser session active to refresh its lease

## Legacy routes

The app still redirects some deleted routes:

- `/tasks` and `/scheduled` → `/automations`
- `/runs` → an owning automation or conversation when possible
- `/tools`, `/instructions`, `/system` → `/settings`
- old notes/skills/nodes routes redirect away from their previous standalone surfaces

## Desktop shell relationship

The desktop shell is a wrapper around the same web app.

Electron adds:

- host switching
- local daemon/web bootstrap
- desktop-specific event transport
- saved remote host support

The core data model stays the same.

## Practical rules

- use Conversations for execution
- use Knowledge for durable files under `<vault-root>`
- use Automations for scheduled background work
- use Settings for machine-local runtime configuration
- do not expect deleted standalone routes to be first-class workflows

## Related docs

- [Conversations](./conversations.md)
- [Knowledge System](./knowledge-system.md)
- [Daemon](./daemon.md)
- [Command-Line Guide (`pa`)](./command-line.md)
