# Getting Started

Use this doc to get `personal-agent` running locally and to verify the important paths.

## Install from source

From the repo root:

```bash
npm install
npm run build
npm link --workspace @personal-agent/cli
```

If you do not want a global `pa` symlink:

```bash
node packages/cli/dist/index.js --help
```

## Verify the install

Run:

```bash
pa doctor
pa status
```

`pa doctor` should confirm that Pi, built artifacts, and the local runtime paths are usable.

## Know the three important roots

- `<state-root>` — machine-local runtime state. Usually `~/.local/state/personal-agent`
- `<config-root>` — machine-local config. Usually `<state-root>/config`
- `<vault-root>` — effective durable knowledge root

`<vault-root>` usually resolves to the managed clone at `<state-root>/knowledge-base/repo` when KB sync is enabled. Otherwise it falls back to the configured `vaultRoot` or `~/Documents/personal-agent`.

## Start an interface

### TUI

```bash
pa tui
```

### Web UI

```bash
pa ui foreground --open
```

For day-to-day managed service mode:

```bash
pa ui install
```

### Browser validation in this repo

When you validate the local web UI with `agent-browser`, use the repo wrapper so Playwright sessions do not pile up:

```bash
npm run ab:run -- --session smoke-check --command "ab open http://127.0.0.1:3741 && ab wait 1000 && ab snapshot -i"
```

See [Agent Browser in this repo](./agent-browser.md).

### Desktop shell

```bash
npm run desktop:start
```

## Create the first durable inputs

### 1. Instruction file

Create a markdown file anywhere under `<vault-root>`, for example:

```text
<vault-root>/instructions/base.md
```

Then select it in Settings or add it to `<config-root>/config.json` under `instructionFiles`.

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
pa tui
pa ui
pa daemon status
pa mcp list --probe
pa profile list
```

## First useful UI flows

- open **Conversations** for live work
- open **Knowledge** to edit files under `<vault-root>`
- open **Automations** to inspect scheduled background work
- open **Settings** to set the default profile, instruction files, skill folders, and provider auth

## If the vault root looks wrong

Check these in order:

1. `PERSONAL_AGENT_VAULT_ROOT`
2. `<config-root>/config.json` → `knowledgeBaseRepoUrl`
3. `<config-root>/config.json` → `vaultRoot`

The environment variable wins.

## Next docs

1. [Decision Guide](./decision-guide.md)
2. [How personal-agent works](./how-it-works.md)
3. [Knowledge System](./knowledge-system.md)
4. [Web UI Guide](./web-ui.md)
5. [Agent Browser in this repo](./agent-browser.md)
