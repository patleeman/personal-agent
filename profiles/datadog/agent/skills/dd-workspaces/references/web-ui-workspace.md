# web-ui Development in a Workspace

This flow changes often. Treat the FRON page and the `web-ui` repo's current onboarding/dev docs as the source of truth:
- https://datadoghq.atlassian.net/wiki/spaces/FRON/pages/6142296780

## Create

```bash
workspaces create <name> --repo web-ui
```

## Environment Setup

Prefer the repo's current bootstrap scripts and docs inside the workspace over hard-coded package-manager recipes here.

Typical flow:
1. Open the `web-ui` repo in the workspace.
2. Follow the repo's current toolchain/bootstrap instructions.
3. Re-open the shell or IDE if setup updates PATH or certificates.

## Run Dev Server

```bash
cd ~/dd/web-ui
yarn
yarn dev
```

Expect to forward port `8443` back to your laptop.

## Access from Laptop

- **VSCode/Cursor**: port forwarding is usually automatic
- **SSH**:
  ```bash
  ssh -L 8443:localhost:8443 workspace-<name>
  ```

Trust the repo-generated local certificate on your laptop using your OS/browser trust workflow, then visit the usual local dev hosts:
- https://dd-dev-local.datad0g.com/
- https://app-dev-local.datadoghq.com/
- https://localhost:8443

## Git Setup

`web-ui` is large. Prefer the team's filtered-fetch / optimized remote configuration guidance from the FRON docs instead of a default full-history fetch.
