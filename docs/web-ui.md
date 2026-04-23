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

Non-default standalone web ports run against an isolated testing state root by default, so ad hoc preview servers do not share the production knowledge-base mirror.

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

Managed knowledge-repo editor for files under `<state-root>/knowledge-base/repo`.

On standalone test ports, that mirror lives under the testing state root unless you explicitly override the runtime paths.

It stays in setup mode until `knowledgeBaseRepoUrl` is configured.

If you still have content in an old unmanaged local vault, copy it into the managed repo yourself before switching over. PA no longer auto-imports legacy vault content.

Use it for:

- file tree navigation
- persisted folder expansion state
- open files in the knowledge sidebar for quick switching between active docs
- resize the open-files shelf to show more or fewer active docs
- markdown editing
- frontmatter disclosure and tag editing
- full-text search
- quick-open
- wikilinks and backlinks
- URL import into the synced repo mirror
- hiding OS junk files like `.DS_Store`, `Thumbs.db`, and AppleDouble `._*` entries from indexed navigation

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

## Page layout rhythm

Top-level web UI pages should share the same structure instead of each route inventing its own chrome.

Use this pattern for main pages:

- intro row with eyebrow, page title, short summary, and optional actions
- top-aligned empty states inside the same content width as the main page body
- sections separated by light top borders instead of nested cards
- a right-side table of contents only for long detail pages like Settings

Keep workspace-style surfaces like Conversations and the Knowledge editor lighter, but make their empty and onboarding states follow the same spacing and typography.

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
