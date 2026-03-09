---
name: dd-workspaces
description: Use when asked about Datadog workspaces — creating, configuring, personalizing, installing tools, dotfiles, secrets, connecting IDEs, using coding agents, or troubleshooting workspace issues.
---

# Datadog Workspaces

Cloud development environments on AWS EC2, managed by the DevX Workspaces team.

## Quick Reference

### Create a workspace
```bash
ddtool auth github login
workspaces create <name> --region <us-east-1|eu-west-3> --repo <repo>
```
Requires Appgate. Name must be unique (`firstname-lastname` recommended).

### Connect
```bash
ssh workspace-<name>
workspaces connect <name> --editor <vscode|cursor|intellij|pycharm|goland>
```

### Delete
```bash
workspaces delete <name>
```

### Lifecycle
- **Garbage collected** after 20 days of no SSH login
- **TTL**: 6 months max, then auto-deleted
- Notifications via SDM Bot on Slack before deletion

## Configuration

Saved at `~/.config/datadog/workspaces/config.yaml` on your **laptop**:

```yaml
shell: zsh                    # bash, fish, zsh
region: us-east-1             # or eu-west-3
dotfiles: https://github.com/USER/dotfiles
editor: cursor                # vscode, cursor, intellij, pycharm, goland
vscode-extensions:
  - ms-azuretools.vscode-docker
jetbrains-plugins:
  - com.github.copilot
```

All flags from `workspaces create --help` can be saved here.

## Dotfiles

- Must be a **public** GitHub repo **outside** the Datadog org
- Referenced via `--dotfiles <url>` or in config.yaml
- Cloned to `$HOME/dotfiles` on the workspace
- **Without `install.sh`**: files are auto-symlinked to `$HOME`
- **With `install.sh`**: script runs, NO auto-symlinking (use `stow` yourself)
- `install.sh` must be executable (`chmod u+x`)
- Cannot clone private repos or access secrets from `install.sh`
- Template: https://github.com/DataDog/workspaces-dotfiles-template
- Debug: `sudo /opt/doghome/sbin/install_dotfiles.sh -r <dotfiles-url>`

## Installing Software

Prefer the least-fragile path:

1. **Dotfiles `install.sh`** — for tools you want on every new workspace.
2. **Repo devcontainer features** — for repo-scoped toolchains that should stay aligned with the project.
3. **Manual package installs after SSH** — for one-off experimentation or temporary setup.

Keep this skill focused on workspace-specific behavior, not volatile package-manager recipes. For detailed install flows, prefer the official **Auto-Install Tools** / workspace docs below or the repo's own `.devcontainer/` guidance.

Repo devcontainer features often provide language/tooling like `go`, `node`, `kubectl`, and `helm`.

## Secrets

Set on your **laptop** before workspace creation:
```bash
workspaces secrets set KEY=VALUE           # written to file on workspace
workspaces secrets set KEY=VALUE --export  # set as env var on workspace

# Common:
workspaces secrets set GITLAB_TOKEN=$(security find-generic-password -a ${USER} -s gitlab_token -w) --export
workspaces secrets set ANTHROPIC_APIKEY1=<key> --export
```

- Only propagate to **future** workspaces, not existing ones
- Manage: `workspaces secrets list`, `get KEY`, `remove KEY`
- On workspace: exported secrets are env vars; file secrets at `/run/user/$(id -u bits)/secrets/`
- Disallowed keys: `PATH`, `ENV`, `USER`, `SHELL`, `HOME`

## Coding Agents in Workspaces

**Claude Code**: Pre-installed via devcontainer feature in most repos. Set up API key locally first.

**Pi**: Install via dotfiles `install.sh` (`npm install -g @mariozechner/pi-coding-agent`) or manually.

**Atlassian MCP auth in workspace**: Use VSCode/Cursor (auto port-forwarding handles OAuth redirect). Alternative: two SSH sessions, start OAuth in one, `curl` the redirect URL from the other.

## IDE Connection

For detailed setup see references/ide-setup.md.

## web-ui Frontend Development

For web-ui workspace setup see references/web-ui-workspace.md.

## Instance Types

| Type | Description |
|------|-------------|
| `aws:m5d.4xlarge` | x86 general purpose |
| `aws:m6gd.4xlarge` | ARM general purpose |
| `aws:g5.2xlarge` | GPU (us-east-1 only) |

## Key Confluence Pages

| Topic | URL |
|-------|-----|
| Getting Started (official) | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/3109585281 |
| Personalizing / Dotfiles | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/3068528729 |
| Secrets Management | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/4063494761 |
| IDE Connection | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/3876553007 |
| Claude in Workspace | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/5607981214 |
| Debugging Dotfiles | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/5086020999 |
| Auto-Install Tools | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/4476960977 |
| web-ui in Workspace | https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/6142296780 |
| Dev Server in Workspace | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/5323785891 |
| Atlassian MCP Auth | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/6029837302 |
| FAQ | https://datadoghq.atlassian.net/wiki/spaces/DEVX/pages/3109814789 |

## Slack

[#workspaces](https://dd.enterprise.slack.com/archives/C02PW2547B9) — ask the Workspaces team directly.
