# Getting Started

Install Personal Agent from source and verify the setup.

## Install from source

```bash
git clone <repo-url>
cd personal-agent
pnpm install
pnpm run setup:hooks   # optional: enable the tracked pre-commit hook
pnpm run build
```

The repo intentionally has no first-party `postinstall`. Third-party build scripts are pinned in `pnpm-workspace.yaml`; review anything newly blocked with `pnpm ignored-builds`.

## Start the desktop app

```bash
pnpm run desktop:start
```

The desktop app manages the local daemon automatically.

## Important paths

- `<state-root>` — machine-local runtime state. Default: `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Default: `<state-root>/config`
- `<vault-root>` — durable knowledge root

## Verify the install

The desktop app starts and loads the conversation view. Create a new conversation and send a message to verify the agent responds.

## Next steps

- [Views](views.md) — understand Conversation and Workbench layout modes
- [Conversations](conversations.md) — how to work with agent threads
- [Desktop App](desktop-app.md) — Electron shell and shortcuts
- [Knowledge](../extensions/system-knowledge/README.md) — vault, skills, instruction files, and sync
- [Configuration](configuration.md) — config files and environment variables
