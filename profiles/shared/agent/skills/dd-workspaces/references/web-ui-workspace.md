# web-ui Development in a Workspace

Status: rapidly changing — check https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/6142296780 for latest.

## Create

```bash
cd ~/path/to/web-ui   # or use --repo
workspaces create <name> --repo web-ui
```

## Environment Setup (Inside Workspace)

Restart the terminal after each step if commands are not found.

```bash
# Volta (Node.js manager)
curl https://get.volta.sh | bash

# Yarn
curl -sS https://repo.yarnpkg.com/install | bash
rm ~/.volta/bin/yarn ~/.volta/bin/yarnpkg

# Run doctor
bash doctor

# Linuxbrew + Watchman
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
brew install watchman
```

## Run Dev Server

```bash
cd ~/dd/web-ui
yarn
yarn dev
# Answer password prompt (create or leave blank)
```

## Access from Laptop

Port 8443 must be forwarded:
- **VSCode/Cursor**: Automatic
- **SSH**: `ssh -L 8443:localhost:8443 workspace-<name>`

Trust the TLS certs on your laptop:
```bash
scp workspace-<name>:~/dd/web-ui/dev/ssl/localhost.crt ~
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/localhost.crt
# Restart browser!
```

Then visit:
- https://dd-dev-local.datad0g.com/
- https://app-dev-local.datadoghq.com/
- https://localhost:8443

## Git Setup

web-ui has hundreds of engineers. Use filtered fetch to speed up git operations.
See https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/2446557878 for the optimized git remote config.

Key idea: only fetch your branches + shared branches (prod, preprod, staging), skip tags.
