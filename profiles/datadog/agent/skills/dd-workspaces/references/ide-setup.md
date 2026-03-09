# IDE Connection Details

## Prerequisites

- Workspaces CLI installed and up to date: `brew update && brew upgrade datadog-workspaces`
- **VSCode/Cursor**: Install Remote Development / Remote-SSH extension, ensure `code`/`cursor` command in PATH
- **JetBrains**: Request Professional license at https://datadog.freshservice.com/support/catalog/items/160, install JetBrains Gateway

## Connect

```bash
workspaces connect <name> --editor <editor> [--repo <repo> | --path <path>]
```

Flags:
- `--editor, -e`: vscode, cursor, intellij, pycharm, goland
- `--path, -p`: specific folder to open (e.g., `/home/bits/dd/dd-source`)
- `--repo, -R`: repo name (e.g., `dogweb`)
- `--vscode-template, -t`: workspace template (`dd-go`, `dogweb`, `dd-source`) or path to `.code-workspace` file

## Port Forwarding

- **VSCode/Cursor**: Automatic — ports are detected and forwarded
- **JetBrains**: Does NOT auto-forward reliably; use SSH instead
- **SSH manual**:
  ```bash
  ssh -L <port>:localhost:<port> workspace-<name>
  ```
- **SSH persistent** (add to `~/.ssh/workspaces/<name>.config`):
  ```
  LocalForward 8443 localhost:8443
  ```

## Mosh (Alternative to SSH)

Better latency, survives laptop sleep. Ports 6001+ are open on workspaces.

```bash
# Laptop
brew install mosh

# Workspace: if needed, build from source inside the workspace
git clone https://github.com/keithw/mosh.git && cd mosh
sudo apt install -y build-essential protobuf-compiler libprotobuf-dev pkg-config libutempter-dev zlib1g-dev libncurses5-dev libssl-dev
./autogen.sh && ./configure && make && sudo make install

# Connect
mosh -p 6001 workspace-<name>
```

Caveat: Mosh does not support SSH agent forwarding. Generate an SSH key on the workspace and upload to GitHub if needed.

## Troubleshooting

- **JetBrains won't open**: Open JetBrains Gateway first, then re-run the connect command
- **VSCode file tree empty**: Install the Remote Development extension
- **"determining if path within a github repo" error**: Ensure you're running from a valid repo or use `--path`/`--repo`
- **JetBrains SSH key prompt**: Select "Forward this request to my SSH agent"
