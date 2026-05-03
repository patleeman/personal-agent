# SSH Remotes

SSH remotes allow the daemon to connect to remote machines over SSH. This enables cross-machine sessions, remote task execution, and access to files on other systems.

## How It Works

The daemon manages SSH target configurations through the Companion API. Each SSH target specifies:

- **Label** — human-readable name for the connection
- **SSH target** — `user@host` string
- **Authentication** — key-based or other method (configured at the SSH level)

```
Desktop ──► Daemon ──► SSH ──► Remote machine
                              │
                         Run commands
                         Access files
```

## Managing SSH Targets

SSH targets are managed through the companion API:

| Method | Endpoint                        | Description                 |
| ------ | ------------------------------- | --------------------------- |
| GET    | `/companion/v1/ssh-targets`     | List all configured targets |
| POST   | `/companion/v1/ssh-targets`     | Add a new target            |
| PATCH  | `/companion/v1/ssh-targets/:id` | Update an existing target   |
| DELETE | `/companion/v1/ssh-targets/:id` | Remove a target             |

### Adding a target

```json
// POST /companion/v1/ssh-targets
{
  "label": "Build Server",
  "sshTarget": "user@build-server.example.com"
}

// Response
{
  "id": "ssh-abc123",
  "label": "Build Server",
  "sshTarget": "user@build-server.example.com",
  "createdAt": "2026-05-01T12:00:00Z"
}
```

## Configuration

SSH targets are stored in the daemon's runtime state. There is no manual config file format — manage them through the API.

SSH key management follows standard SSH conventions:

- Keys in `~/.ssh/id_rsa`, `~/.ssh/id_ed25519`, etc.
- `~/.ssh/config` for host aliases and options
- `~/.ssh/known_hosts` for host key verification

## Use Cases

- **Remote builds** — run build commands on a remote build server
- **File access** — read and edit files on a remote machine
- **Cross-machine workflows** — start a task on one machine, check results from another
- **Multi-environment testing** — run tasks in staging, production, or test environments

## Prerequisites

- SSH access configured between the local and remote machines
- Key-based authentication is recommended (password auth may not work in automated contexts)
- The remote machine must have a compatible SSH server running
- The SSH user must have the necessary permissions for the intended operations

## Security

- SSH credentials are not stored by the daemon — it relies on the system's SSH configuration
- Connections are encrypted via the SSH protocol
- Access to the daemon controls SSH target management, so daemon API security governs who can add/remove targets
