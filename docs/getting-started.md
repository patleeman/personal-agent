# Getting Started

Use this doc to get `personal-agent` running locally and to verify the important paths.

## Install from source

From the repo root:

```bash
npm install
npm run build
npm run build
```

## Verify the install

The desktop app manages the local daemon runtime automatically. Start the Personal Agent desktop app from the build output or from the installed `.app` bundle.

## Know the three important roots

- `<state-root>` — machine-local runtime state. Usually `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Usually `<state-root>/config`
- `<vault-root>` — effective durable knowledge root

`<vault-root>` usually resolves to the managed clone at `<state-root>/knowledge-base/repo` when KB sync is enabled. Otherwise it falls back to the legacy `vaultRoot` config value or `~/Documents/personal-agent`.

## Start an interface

### Desktop app

```bash
npm run desktop:start
```

This builds the Electron shell and opens the app. `npm run desktop:dev` uses the same Electron dev launcher today. Prefer `desktop:start` in setup docs and smoke checks because it is the stable repo-level entry point.

### TUI (terminal)

```bash
pa tui
```

The TUI is useful for quick terminal-based sessions. For the full experience, use the desktop app.


## Create the first durable inputs

### 1. Instruction file

Create a markdown file anywhere under `<vault-root>`, for example:

```text
<vault-root>/instructions/base.md
```

Then select it in Settings or add it to `<config-root>/config.json` under `instructionFiles`.

Profile-scoped settings and models live under `<config-root>/profiles/<profile>/`, not in the shared vault.

### 2. Durable knowledge doc

Create a normal markdown file or doc package:

```text
<vault-root>/systems/runtime-model.md
<vault-root>/systems/runtime-model/INDEX.md
```

### 3. Skill

Create a reusable workflow skill at:

```text
<vault-root>/skills/agent-browser/SKILL.md
```

## First useful commands

```bash
npm run desktop:start
pa tui
pa daemon status
pa mcp list --probe
```

## First useful UI flows

- open **Conversations** for live agent sessions
- open **Knowledge** to browse and edit the durable vault
- open **Automations** to inspect scheduled background work
- open **Settings** to set defaults, instruction files, skill folders, provider auth, Knowledge base sync, companion pairing, transcription, and title-generation settings

## If the vault root looks wrong

Check these in order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. `<config-root>/config.json` → `knowledgeBaseRepoUrl`
3. legacy `<config-root>/config.json` → `vaultRoot`

The environment variable wins. New setups should use the built-in Knowledge base repo instead of editing `vaultRoot` directly.

## Next docs

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge System](./knowledge-system.md)
4. [Desktop App](./desktop-app.md)
