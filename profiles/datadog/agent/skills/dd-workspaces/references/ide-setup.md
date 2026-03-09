# IDE Connection Details

## Prerequisites

- Workspaces CLI installed and reasonably current
- **VSCode/Cursor**: Remote Development / Remote-SSH extension installed; `code` / `cursor` available in PATH
- **JetBrains**: JetBrains Gateway installed and a valid Professional license

## Connect

```bash
workspaces connect <name> --editor <editor> [--repo <repo> | --path <path>]
```

Useful flags:
- `--editor, -e`: vscode, cursor, intellij, pycharm, goland
- `--path, -p`: folder to open (for example `/home/bits/dd/dd-source`)
- `--repo, -R`: repo name (for example `dogweb`)
- `--vscode-template, -t`: workspace template (`dd-go`, `dogweb`, `dd-source`) or a `.code-workspace` path

## Port Forwarding

- **VSCode/Cursor**: usually auto-forwards detected ports
- **JetBrains**: be ready to forward ports manually
- **SSH manual**:
  ```bash
  ssh -L <port>:localhost:<port> workspace-<name>
  ```
- **Persistent SSH config**:
  ```
  LocalForward 8443 localhost:8443
  ```

## Mosh

If you already use Mosh, it can be a good SSH alternative for high-latency connections and laptop sleep/resume:

```bash
mosh -p 6001 workspace-<name>
```

Caveat: Mosh does not support SSH agent forwarding. Prefer the current workspace or official docs for install details instead of hard-coding package-manager steps here.

## Troubleshooting

- **JetBrains won't open**: open JetBrains Gateway first, then re-run `workspaces connect`
- **VSCode file tree empty**: confirm the Remote Development / Remote-SSH extension is installed
- **`determining if path within a github repo` error**: run from a valid repo or use `--path` / `--repo`
- **JetBrains SSH key prompt**: choose SSH agent forwarding if that is your intended auth path
