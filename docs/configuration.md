# Configuration

This page explains the user-facing configuration model for `personal-agent`.

The guiding principle is:

- keep durable defaults in files
- use environment variables mainly for machine-local bootstrapping and external secret resolution

## The main config files

### `~/.local/state/personal-agent/config/config.json`

This stores the default profile.

Example:

```json
{
  "defaultProfile": "assistant"
}
```

Useful command:

```bash
pa profile use assistant
```

This file is machine-local runtime config and is intentionally not part of the synced durable surface.

### `~/.local/state/personal-agent/config/daemon.json`

This configures the background daemon.

Common reasons to edit it:

- change timeouts or retry behavior
- change socket or queue settings
- override task discovery only if you intentionally want a non-default task dir

Example:

```json
{
  "logLevel": "info",
  "modules": {
    "tasks": {
      "enabled": true,
      "taskDir": "~/.local/state/personal-agent/sync/tasks",
      "tickIntervalSeconds": 30,
      "maxRetries": 3,
      "defaultTimeoutSeconds": 1800
    }
  }
}
```

See [Daemon and Background Automation](./daemon.md) and [Scheduled Tasks](./scheduled-tasks.md).

### `~/.local/state/personal-agent/config/gateway.json`

This stores gateway setup, typically written by:

```bash
pa gateway setup telegram
```

Use it for:

- gateway profile
- gateway default model
- Telegram token
- allowlisted chats
- allowed user ids
- blocked user ids
- gateway cwd and queue limits

Saved gateway settings are read from this file rather than per-setting environment-variable overrides.

You can write this file either with `pa gateway setup telegram` or from the web UI Gateway page. The web UI also supports saving `op://...` 1Password references for supported gateway values.

See [Gateway Guide](./gateway.md).

### `~/.local/state/personal-agent/config/execution-targets.json`

This stores machine-local execution targets for remote conversation offload.

Use it for:

- named SSH destinations such as `gpu-box` or `runpod-a100`
- remote default working directories
- local repo path → remote checkout mappings
- optional remote profile / `pa` command overrides
- installed remote runtime bundles created by `pa targets install <id>`

Prefer writing this file with:

```bash
pa targets list
pa targets add <id> --label <label> --ssh <destination>
```

Because SSH destinations and path mappings are often machine-specific, this file is generally local runtime config rather than shared profile state.

## Profile resource configuration

Profile resources resolve from repo defaults plus synced durable roots:

- repo shared defaults from `defaults/agent`
- repo built-ins from `extensions/` and `themes/`
- synced durable resources under `~/.local/state/personal-agent/sync/`

Common durable roots:

- `profiles/*.json`
- `agents/**`
- `settings/**`
- `models/**`
- `skills/**`
- `memory/**`
- `tasks/`
- `projects/`

See [Profiles, Memory, and Skills](./profiles-memory-skills.md).

## Layering and precedence

Profile resources resolve in this order:

1. repo `defaults/agent`
2. synced durable resources under `~/.local/state/personal-agent/sync/`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

Higher layers override lower layers where that makes sense.

A simple way to think about it:

- repo defaults = common built-in defaults
- synced durable roots = shared or profile-targeted overrides
- local overlay = machine-local additions

## Runtime state location

Mutable runtime state is kept outside the repo.

Default root:

- `~/.local/state/personal-agent`

This includes:

- auth
- live/saved session state
- daemon state and logs
- gateway spools and logs
- conversation-local bindings

Do not point runtime state inside the git repo.

For one-time migration from legacy `~/.config/personal-agent` and `~/.pi/agent` locations,
run `./scripts/migrate-state-home.sh` from the repo root.

Canonical state-home layout:

```text
~/.local/state/personal-agent/
├── sync/                      # git-synced durable state
│   ├── profiles/
│   ├── agents/
│   ├── settings/
│   ├── models/
│   ├── skills/
│   ├── memory/
│   ├── tasks/
│   ├── projects/
│   └── pi-agent/
│       └── sessions/
├── profiles -> sync/profiles  # durable profile definitions
├── pi-agent/                  # local runtime state
│   ├── state/
│   └── deferred-resumes-state.json
├── pi-agent-runtime/          # generated runtime materialization
├── config/
│   ├── config.json
│   ├── daemon.json
│   ├── gateway.json
│   └── web.json
├── daemon/
├── gateway/
├── web/
└── logs/
```

Note: legacy top-level `tmux/` and `tmux-logs/` are intentionally not part of the canonical layout.

For git-based automatic cross-machine sync, use:

- `pa sync setup --repo <git-url> --fresh` (first machine / new remote)
- `pa sync setup --repo <git-url> --bootstrap` (additional machines / existing remote history)

You can do the same setup from the Web UI **Sync** tab.

Setup enables the daemon sync module and schedules periodic background sync.

By default, sync tracks:

- `profiles/*.json`
- `agents/**`
- `settings/**`
- `models/**`
- `skills/**`
- `memory/**`
- `tasks/**`
- `projects/**`
- `pi-agent/sessions/**`

Machine-local runtime files such as auth, inbox state, conversation attention, deferred resumes, generated prompt materialization, and `bin/**` are not synced.

See [Sync Guide](./sync.md).

## Important environment variables

### Profile and repo selection

- `PERSONAL_AGENT_REPO_ROOT` — override the repo root (shared defaults)
- `PERSONAL_AGENT_PROFILES_ROOT` — override the mutable profiles root
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR` — override the local overlay dir
- `PERSONAL_AGENT_PROFILE` — override the active profile for some runtime surfaces, especially daemon and CLI contexts

### Runtime state

- `PERSONAL_AGENT_STATE_ROOT` — override the runtime state root
- `PERSONAL_AGENT_AUTH_PATH`
- `PERSONAL_AGENT_SESSION_PATH`
- `PERSONAL_AGENT_CACHE_PATH`

### Daemon

- `PERSONAL_AGENT_DAEMON_CONFIG` — alternate daemon config file
- `PERSONAL_AGENT_DAEMON_SOCKET_PATH` — default daemon socket path
- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1` — disable daemon integration explicitly

### Gateway

- `PERSONAL_AGENT_GATEWAY_CONFIG_FILE` — alternate gateway config file

### Web UI

- `PERSONAL_AGENT_WEB_CONFIG_FILE` — override `~/.local/state/personal-agent/config/web.json`
- `PERSONAL_AGENT_WEB_TAILSCALE_SERVE` — runtime override (`true`/`false`) for `pa ui` foreground launches

### 1Password secrets

If you store secrets as `op://...` references:

- `PERSONAL_AGENT_OP_BIN` (default `op`)
- `PERSONAL_AGENT_OP_READ_TIMEOUT_MS`
- `OP_SERVICE_ACCOUNT_TOKEN` if using a 1Password service account

## Model, working directory, theme, and web UI defaults

The agent's default model, thinking level, fallback working directory, theme mapping, and some web UI behavior usually belong in profile `settings.json`.

Example:

```json
{
  "defaultProvider": "openai-codex",
  "defaultModel": "gpt-5.4",
  "defaultThinkingLevel": "xhigh",
  "defaultCwd": "~/workingdir/personal-agent",
  "themeDark": "cobalt2",
  "themeLight": "cobalt2-light",
  "themeMode": "system",
  "webUi": {
    "conversationTitles": {
      "enabled": true,
      "model": "openai-codex/gpt-5.1-codex-mini"
    }
  }
}
```

These defaults are used when a run does not explicitly override them.

`defaultCwd` is the fallback working directory for new web conversations and other web-triggered runs when no explicit cwd is set and no single referenced project `repoRoot` applies.

`webUi.conversationTitles.model` is optional. If omitted, conversation auto-titles fall back to the saved runtime default model.

### Web UI runtime config

`pa ui` and the managed web UI service use `~/.local/state/personal-agent/config/web.json`:

```json
{
  "port": 3741,
  "useTailscaleServe": false
}
```

This file persists the web UI port and whether `tailscale serve` should be enabled for the web UI. It is managed by the CLI and editable if needed.
When that setting is toggled via `pa ui` or the Web UI page, `personal-agent` also runs the matching `tailscale serve` command for `localhost:<port>`.

You can also adjust model, theme, and conversation title settings from the web UI Settings page.

## Recommended approach

For most setups:

1. set the default profile with `pa profile use <name>`
2. keep durable behavior and knowledge in the synced roots under `~/.local/state/personal-agent/sync/` (with repo defaults in `defaults/agent` and optional machine-local additions in `~/.local/state/personal-agent/config/local`)
3. keep daemon behavior in `daemon.json`
4. use `pa gateway setup telegram` for gateway config
5. keep secrets as 1Password references where possible; use env vars only when a component truly needs them

## Related docs

- [Getting Started](./getting-started.md)
- [Profiles, Memory, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Sync Guide](./sync.md)
- [Gateway Guide](./gateway.md)
- [Troubleshooting](./troubleshooting.md)
