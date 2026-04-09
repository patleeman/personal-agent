# Configuration

This page explains the user-facing configuration model for `personal-agent`.

The guiding principle is:

- keep durable defaults in files
- use environment variables mainly for machine-local bootstrapping and external secret resolution

## The main machine-local config file

### `~/.local/state/personal-agent/config/config.json`

This is the canonical machine-local config file.

It stores machine-specific settings such as:

- default profile selection
- daemon overrides
- web UI runtime preferences

Example:

```json
{
  "defaultProfile": "assistant",
  "daemon": {
    "logLevel": "info",
    "modules": {
      "tasks": {
        "enabled": true,
        "taskDir": "~/.local/state/personal-agent/sync/_tasks",
        "tickIntervalSeconds": 30,
        "maxRetries": 3,
        "defaultTimeoutSeconds": 1800
      }
    }
  },
  "webUi": {
    "port": 3741,
    "companionPort": 3742,
    "useTailscaleServe": false,
    "resumeFallbackPrompt": "Continue from where you left off."
  }
}
```

Useful commands:

```bash
pa profile use assistant
```

This file is machine-local runtime config and is intentionally not part of the durable content surface.

Legacy sibling files such as `daemon.json` and `web.json` are read for compatibility when present, but `config.json` is the single canonical write target now.

## Profile resource configuration

Profile resources resolve from repo defaults plus durable roots:

- repo shared defaults from `defaults/agent`
- repo built-ins from `extensions/` and `themes/`
- durable resources under `~/.local/state/personal-agent/sync/`

Common durable roots:

- `_profiles/<profile>/AGENTS.md`
- `_profiles/<profile>/settings.json`
- `_profiles/<profile>/models.json`
- `_skills/**`
- `notes/**`
- `tasks/`
- `projects/`

See [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md).

## Layering and precedence

Profile resources resolve in this order:

1. repo `defaults/agent`
2. durable resources under `~/.local/state/personal-agent/sync/`
3. local overlay (`~/.local/state/personal-agent/config/local` by default)

Higher layers override lower layers where that makes sense.

A simple way to think about it:

- repo defaults = common built-in defaults
- durable roots = shared or profile-targeted overrides
- local overlay = machine-local additions

## Runtime state location

Mutable runtime state is kept outside the repo.

Default root:

- `~/.local/state/personal-agent`

This includes:

- auth
- live/saved session state
- daemon state and logs
- conversation-local bindings

Do not point runtime state inside the git repo.

For one-time migration from legacy `~/.config/personal-agent` and `~/.pi/agent` locations,
run `./scripts/migrate-state-home.sh` from the repo root.

Canonical state-home layout:

```text
~/Documents/personal-agent/     # external durable knowledge vault
├── _profiles/
├── _skills/
├── notes/
└── projects/

~/.local/state/personal-agent/
├── sync/                       # app-managed durable state subtree
│   ├── tasks/
│   └── pi-agent/
│       ├── sessions/
│       └── state/
│           └── conversation-attention/
├── pi-agent/                   # local runtime state
│   ├── state/
│   └── deferred-resumes-state.json
├── pi-agent-runtime/           # generated runtime materialization
├── config/
│   └── config.json
├── daemon/
├── web/
└── logs/
```

Note: legacy top-level `tmux/` and `tmux-logs/` are intentionally not part of the canonical layout.

The app-managed durable subtree under `~/.local/state/personal-agent/sync/` holds task definitions plus durable conversation session/attention files:

- `tasks/**`
- `pi-agent/sessions/**`
- `pi-agent/state/conversation-attention/**`

The external knowledge vault (default: `~/Documents/personal-agent`) stays separate. You can override it with `PERSONAL_AGENT_VAULT_ROOT`, set `vaultRoot` in machine `config.json`, or use the desktop web UI Settings page. Machine-local runtime files such as auth, inbox state, deferred resumes, generated prompt materialization, and `bin/**` stay outside the durable subtree.

## Important environment variables

### Profile and repo selection

- `PERSONAL_AGENT_REPO_ROOT` — override the repo root (shared defaults)
- `PERSONAL_AGENT_PROFILES_ROOT` — override the mutable profiles root
- `PERSONAL_AGENT_LOCAL_PROFILE_DIR` — override the local overlay dir
- `PERSONAL_AGENT_PROFILE` — override the active profile for some runtime surfaces, especially daemon and CLI contexts

### Runtime state

- `PERSONAL_AGENT_STATE_ROOT` — override the runtime state root
- `PERSONAL_AGENT_VAULT_ROOT` — override the external knowledge vault root (default auto-detects `~/Documents/personal-agent`; this wins over machine config `vaultRoot`)
- `PERSONAL_AGENT_AUTH_PATH`
- `PERSONAL_AGENT_SESSION_PATH`
- `PERSONAL_AGENT_CACHE_PATH`

### Daemon

- `PERSONAL_AGENT_DAEMON_SOCKET_PATH` — default daemon socket path
- `PERSONAL_AGENT_DISABLE_DAEMON_EVENTS=1` — disable daemon integration explicitly
- `PERSONAL_AGENT_DAEMON_CONFIG` — optional legacy override path for daemon-only config migration/compatibility

### Web UI

- `PERSONAL_AGENT_WEB_TAILSCALE_SERVE` — runtime override (`true`/`false`) for `pa ui` foreground launches
- `PERSONAL_AGENT_WEB_CONFIG_FILE` — optional legacy override path for web-ui-only config migration/compatibility

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

`defaultCwd` is the working-directory default for new web conversations and other web-triggered runs when no explicit cwd is set.

`webUi.conversationTitles.model` is optional. If omitted, conversation auto-titles fall back to the saved runtime default model.

Auto-titles are generated from the early visible user/assistant exchange and bias toward short, scan-friendly, topic-first labels so thread lists are easier to skim.

### Web UI runtime config

`pa ui` and the managed web UI service persist their machine-local settings under the `webUi` section in `~/.local/state/personal-agent/config/config.json`:

```json
{
  "webUi": {
    "port": 3741,
    "companionPort": 3742,
    "useTailscaleServe": false,
    "resumeFallbackPrompt": "Continue from where you left off."
  }
}
```

That section persists the web UI port, companion port, Tailscale Serve preference, and resume fallback prompt. It is managed by the CLI and editable if needed.
When that setting is toggled via `pa ui` or the Web UI page, `personal-agent` also runs the matching `tailscale serve` command for `localhost:<port>`.

You can also adjust model, theme, and conversation title settings from the web UI Settings page.

## Recommended approach

For most setups:

1. set the default profile with `pa profile use <name>`
2. keep durable task/session state in the app-managed subtree under `~/.local/state/personal-agent/sync/` and durable knowledge in the external vault plus repo defaults
3. keep machine-local app behavior in `config/config.json`
4. keep secrets as 1Password references where possible; use env vars only when a component truly needs them

## Related docs

- [Decision Guide](./decision-guide.md)
- [Getting Started](./getting-started.md)
- [Profiles, AGENTS, Pages, and Skills](./profiles-memory-skills.md)
- [Scheduled Tasks](../internal-skills/scheduled-tasks/INDEX.md)
- [Troubleshooting](./troubleshooting.md)
