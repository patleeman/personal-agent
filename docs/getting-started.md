# Getting Started

Install Personal Agent from source and verify the setup.

## Install from source

```bash
git clone <repo-url>
cd personal-agent
npm install
npm run setup:hooks   # optional: enable the tracked pre-commit hook
npm run build
```

The repo intentionally has no first-party `postinstall`. If you install with `--ignore-scripts`, Electron, esbuild, and native dependency setup will be skipped.

## Start the desktop app

```bash
npm run desktop:start
```

The desktop app manages the local daemon automatically.

## Important paths

- `<state-root>` — machine-local runtime state. Default: `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Default: `<state-root>/config`
- `<vault-root>` — durable knowledge root

## Verify the install

The desktop app starts and loads the conversation view. Create a new conversation and send a message to verify the agent responds.

## Next steps

- [Views](views.md) — understand the three layout modes
- [Conversations](conversations.md) — how to work with agent threads
- [Desktop App](desktop-app.md) — Electron shell and shortcuts
- [Knowledge](../extensions/system-knowledge/README.md) — vault, skills, instruction files, and sync
- [Configuration](configuration.md) — config files and environment variables
