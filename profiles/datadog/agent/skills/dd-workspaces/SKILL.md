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
Requires Appgate. Takes ~10 min. Name must be unique (`firstname-lastname` recommended).

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

Three approaches:

1. **`install.sh` in dotfiles** (automatic on creation) — best for tools you always want
2. **Manual after SSH** — `sudo apt-get install`, curl scripts, etc.
3. **Devcontainer features** — pre-installed by repo's `.devcontainer/` definition

Common installs on Ubuntu workspace:
```bash
# apt
sudo apt-get install -y stow fzf ripgrep fd-find jq tmux htop wget

# GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list
sudo apt-get update && sudo apt-get install -y gh

# Neovim (from GitHub releases)
curl -fsSL https://github.com/neovim/neovim/releases/download/v0.10.3/nvim-linux64.tar.gz | sudo tar xz -C /opt/
sudo ln -sf /opt/nvim-linux64/bin/nvim /usr/local/bin/nvim

# eza (modern ls)
sudo mkdir -p /etc/apt/keyrings
wget -qO- https://raw.githubusercontent.com/eza-community/eza/main/deb.asc | sudo gpg --dearmor -o /etc/apt/keyrings/gierens.gpg
echo "deb [signed-by=/etc/apt/keyrings/gierens.gpg] http://deb.gierens.de stable main" | sudo tee /etc/apt/sources.list.d/gierens.list
sudo apt-get update && sudo apt-get install -y eza

# lazygit
LAZYGIT_VERSION=$(curl -fsSL https://api.github.com/repos/jesseduffield/lazygit/releases/latest | jq -r '.tag_name' | sed 's/^v//')
curl -fsSL "https://github.com/jesseduffield/lazygit/releases/download/v${LAZYGIT_VERSION}/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz" | tar xz -C /tmp lazygit
sudo install /tmp/lazygit /usr/local/bin/lazygit

# Linuxbrew (optional, heavy)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# Volta (Node.js manager)
curl https://get.volta.sh | bash

# Oh My Zsh
sh -c "$(curl -fsSL https://raw.github.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
```

Tools like `go`, `node`, `kubectl`, `helm` are often pre-installed by devcontainer features.

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
