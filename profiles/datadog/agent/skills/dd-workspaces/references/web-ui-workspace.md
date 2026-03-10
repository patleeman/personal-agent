# web-ui Development in a Workspace

Status: rapidly changing — treat the official guide as the source of truth:
- https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/6142296780

Use this note as a durable checklist, not a copy of every current bootstrap command.

## Create

```bash
cd ~/path/to/web-ui   # or use --repo
workspaces create <name> --repo web-ui
```

## Bootstrap Inside the Workspace

- Follow the latest `web-ui` workspace/bootstrap steps from the official FRON guide.
- Prefer repo-provided bootstrap tooling (for example `doctor`) and workspace/devcontainer setup over memorizing package-manager recipes here.
- If newly installed commands are not found, restart the shell before assuming the setup failed.

## Run the Dev Server

```bash
cd ~/dd/web-ui
yarn
yarn dev
# Answer password prompt (create or leave blank)
```

## Access from the Laptop

Port `8443` must be forwarded:
- **VSCode/Cursor**: automatic
- **SSH**: `ssh -L 8443:localhost:8443 workspace-<name>`

Trust the TLS cert on your laptop:

```bash
scp workspace-<name>:~/dd/web-ui/dev/ssl/localhost.crt ~
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/localhost.crt
# Restart browser
```

Then visit one of:
- https://dd-dev-local.datad0g.com/
- https://app-dev-local.datadoghq.com/
- https://localhost:8443

## Git Setup

`web-ui` has a very large contributor base. Use the optimized/filtered fetch setup rather than a full default fetch:
- https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/2446557878

Key idea: fetch only the branches you need (plus shared environment branches such as prod/preprod/staging) and skip tags when possible.
