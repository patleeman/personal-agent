# Getting Started

This guide gets `personal-agent` into a usable state quickly.

## What you are setting up

`personal-agent` gives Pi a durable layer:

- profiles and reusable resources live in git
- mutable runtime state stays local
- the daemon handles background automation
- the web UI and Telegram gateway expose the same underlying agent system

## Prerequisites

- Node.js 20+
- npm
- a checkout of this repository

## Install from source

From the repo root:

```bash
npm install
npm run build
npm link --workspace @personal-agent/cli
```

If you do not want to link the CLI globally, you can run it with:

```bash
npm exec pa -- --help
```

## Verify the setup

Run:

```bash
pa doctor
```

This confirms that:

- a runnable Pi binary is available
- profiles can be discovered
- runtime state paths are valid
- the runtime agent directory can be prepared

## Choose your default profile

List profiles:

```bash
pa profile list
```

Set one:

```bash
pa profile use assistant
```

You can always override per run:

```bash
pa tui --profile assistant
pa tui --profile assistant -p "hello"
```

## Start the daemon

The daemon is recommended if you use:

- scheduled tasks
- deferred resume
- gateway notifications
- always-on background automation

Recommended:

```bash
pa daemon service install
```

If you just want to try it in the foreground first:

```bash
pa daemon start
```

Check status:

```bash
pa daemon status
```

## Open the web UI

Start the app:

```bash
pa ui --open
```

By default it runs on:

- `http://localhost:3741`

The web UI is the easiest place to explore:

- Inbox
- Conversations
- Projects
- Scheduled tasks
- Sync state
- Gateway state
- Memory
- Settings

See [Web UI Guide](./web-ui.md).

## Optional: set up cross-machine sync

If you want durable state synced across devices, run:

```bash
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --fresh
```

On additional devices, use `--bootstrap` instead:

```bash
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
```

You can also do this from the Web UI **Sync** tab.

See [Sync Guide](./sync.md).

## Optional: use the terminal UI directly

Launch Pi with your resolved profile resources:

```bash
pa tui
```

Or send a one-off prompt:

```bash
pa tui -p "Summarize my current profile"
```

## Optional: set up Telegram

Telegram is the current gateway provider.

Interactive setup:

```bash
pa gateway setup telegram
```

Recommended for 24/7 use:

```bash
pa gateway service install telegram
```

This installs the managed gateway service and also ensures the daemon is provisioned.

See [Gateway Guide](./gateway.md).

## First things to try

### Inspect durable state

```bash
pa inbox list
pa memory list
pa tasks list
```

### Open a conversation in the web UI

- run `pa ui --open`
- start a new conversation
- mention a project with `@project-id` or create one from the Projects page

### Create a memory note

```bash
pa memory new quick-note \
  --title "Quick note" \
  --summary "What this note is for" \
  --tags notes
```

### Validate scheduled tasks

```bash
pa tasks validate --all
```

## Recommended reading order

After this page:

1. [How personal-agent works](./how-it-works.md)
2. [Web UI Guide](./web-ui.md)
3. [Sync Guide](./sync.md)
4. [Projects](./projects.md)
5. [Profiles, Memory, and Skills](./profiles-memory-skills.md)
6. [Scheduled Tasks](./scheduled-tasks.md)

## If something fails

Start with:

```bash
pa doctor
pa daemon status
```

Then use [Troubleshooting](./troubleshooting.md).
