# Command-Line Guide (`pa`)

`pa` is the main command-line entry point for `personal-agent`.

It has two jobs:

1. launch Pi with the right profile resources
2. manage the durable features around Pi

## Command model

### 1. Run Pi with profile resources

Use:

```bash
pa tui
pa tui --profile assistant
pa tui -p "hello"
pa tui --profile assistant -p "hello"
```

Pi passthrough now requires the explicit `tui` subcommand. Unknown top-level commands or options are CLI errors.

Example:

```bash
pa tui -p "summarize this repo"
```

### 2. Manage durable features

These commands are handled by `personal-agent` itself:

- `pa install ...`
- `pa profile ...`
- `pa doctor`
- `pa daemon ...`
- `pa tasks ...`
- `pa inbox ...`
- `pa ui ...`
- `pa note ...`
- `pa node ...`
- `pa mcp ...`
- `pa runs ...`
- `pa targets ...`
- `pa sync ...`
- `pa restart`
- `pa update`

## Most useful commands

### Setup and health

```bash
pa doctor
pa install https://github.com/davebcn87/pi-autoresearch
pa profile list
pa profile use <name>
pa daemon status
```

### Daily use

```bash
pa ui --open
pa tui
pa tui -p "hello"
pa inbox list
pa node list
pa mcp list
pa tasks list
pa targets list
pa sync status
```

### Background automation

```bash
pa daemon start
pa daemon service install
pa tasks validate --all
pa tasks logs <id>
```

### Remote execution targets

```bash
pa targets list
pa targets add gpu-box --label "GPU Box" --ssh gpu-box --default-cwd /srv/personal-agent --map /Users/patrickc.lee/personal/personal-agent=/srv/personal-agent
pa targets install gpu-box
pa targets show gpu-box
```

## Top-level command reference

### `pa tui [args...]`

Launch Pi with the resolved active profile.

### `pa install <source> [--profile <name> | -l | --local]`

Add a Pi package source to durable `pa` settings.

By default this writes to the active profile's mutable `settings.json` in the configured profiles root.
Use `--local` to write to the machine-local overlay instead.

Examples:

```bash
pa install https://github.com/davebcn87/pi-autoresearch
pa install npm:@scope/package@1.2.3
pa install ./my-package
pa install --profile assistant https://github.com/user/repo
pa install --local ./my-package
```

### `pa profile [list|show|use]`

Manage the active profile.

Examples:

```bash
pa profile list
pa profile show
pa profile use assistant
```

### `pa doctor [--json]`

Run setup checks.

### `pa daemon [status|start|stop|restart|logs|service|help]`

Manage the background daemon.

Examples:

```bash
pa daemon status
pa daemon start
pa daemon service install
```

### `pa tasks [list|show|validate|logs]`

Inspect scheduled daemon tasks.

Examples:

```bash
pa tasks list
pa tasks show <id>
pa tasks validate --all
pa tasks logs <id> --tail 120
```

See [Scheduled Tasks](./scheduled-tasks.md).

### `pa inbox [list|show|create|read|unread|delete]`

Inspect and manage surfaced inbox items.

Examples:

```bash
pa inbox list
pa inbox list --conversations
pa inbox show activity:nightly-review
pa inbox show conversation:conv-123
pa inbox create "Nightly review finished" --kind note
pa inbox read conversation:conv-123
```

See [Inbox and Activity](./inbox.md).

### `pa ui [--open] [--port <port>] [--tailscale-serve|--no-tailscale-serve]`

Start the web UI in the foreground.

Examples:

```bash
pa ui
pa ui --open
pa ui --port 4000
pa ui --tailscale-serve
```

`--tailscale-serve` and `--no-tailscale-serve` apply the Tailscale Serve change immediately by invoking the `tailscale` CLI for `localhost:<port>`.

Useful related commands:

```bash
pa ui logs --tail 120
pa ui service install --port 3741 [--tailscale-serve|--no-tailscale-serve]
pa ui service status [--port <port>] [--tailscale-serve|--no-tailscale-serve]
pa ui service restart [--port <port>] [--tailscale-serve|--no-tailscale-serve]
```

See [Web UI Guide](./web-ui.md).

### `pa node [list|find|show|get|new|update|delete|tag|lint|migrate]`

Work with the unified durable node store under `sync/nodes/`.

Examples:

```bash
pa node list
pa node find "type:skill AND profile:assistant"
pa node show agent-browser
pa node new quick-note --title "Quick note" --summary "Captured thought." --tag type:note
pa node tag quick-note --add area:notes
pa node migrate
pa node lint
```

See [Nodes](./nodes.md).

### `pa note [list|find|show|new|lint]`

Compatibility surface for the shared note subset. Use `pa node` for new work.

Examples:

```bash
pa note list
pa note find --type reference --area personal-agent
pa note show quick-note
pa note new note-index --title "Note index" --summary "Top-level note table of contents" --type reference --area notes
pa note lint
```

See [Profiles, AGENTS, Notes, and Skills](./profiles-memory-skills.md).

### `pa mcp [list|info|grep|call|auth|logout]`

Inspect and call configured MCP servers using pa’s native MCP client.

Examples:

```bash
pa mcp list
pa mcp list --probe
pa mcp list --probe -d
pa mcp info atlassian
pa mcp info atlassian/getConfluencePage
pa mcp grep '*jira*'
pa mcp call atlassian getAccessibleAtlassianResources '{}'
pa mcp auth slack
pa mcp logout slack
```

`pa mcp list` is config-only by default. Use `--probe` to connect to servers and fetch tool metadata.

See [MCP](./mcp.md).

Native remote MCP config example:

```json
{
  "mcpServers": {
    "atlassian": {
      "type": "remote",
      "url": "https://mcp.atlassian.com/v1/mcp"
    },
    "slack": {
      "type": "remote",
      "url": "https://mcp.slack.com/mcp",
      "callback": {
        "host": "localhost",
        "port": 3118,
        "path": "/callback"
      },
      "oauth": {
        "clientId": "1601185624273.8899143856786"
      }
    }
  }
}
```

### `pa runs [list|show|logs|start|start-agent|cancel|help]`

Inspect and manage durable daemon-backed background runs.

Examples:

```bash
pa runs list
pa runs show <id>
pa runs logs <id> --tail 120
pa runs start code-review -- npm test
pa runs start-agent code-review --prompt "review this diff"
pa runs cancel <id>
```

Use this as the main control surface for detached local background work.

See [Runs](./runs.md).

### `pa targets [list|show|add|update|install|delete|help]`

Inspect and manage machine-local execution targets for remote conversation offload.

Examples:

```bash
pa targets list
pa targets show gpu-box
pa targets add gpu-box --label "GPU Box" --ssh gpu-box --default-cwd /srv/personal-agent --map /Users/patrickc.lee/personal/personal-agent=/srv/personal-agent
pa targets install gpu-box
pa targets update gpu-box --remote-pa-command /opt/bin/pa --profile datadog
pa targets delete gpu-box
```

`pa targets install <id>` uploads the current built `personal-agent` runtime bundle plus synced profile/auth state to the remote target so remote runs do not require a full `personal-agent` checkout on that machine.

Targets are stored in `~/.local/state/personal-agent/config/execution-targets.json` by default.
Use this when you want your local agent to configure remote SSH destinations without hand-editing the System page form.

See [Execution Targets](./execution-targets.md).

### `pa sync [status|run|setup|help]`

Configure and trigger automatic git sync for durable state.

Examples:

```bash
pa sync status
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --fresh
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync setup --repo <git-url> --branch main --repo-dir ~/.local/state/personal-agent/sync
pa sync run
```

Use `--fresh` for first-time setup into a new/empty remote. Use `--bootstrap` on additional devices (or existing remotes with history).

The setup command moves syncable state under `<stateRoot>/sync`, configures the daemon sync module, and enables periodic background git sync.

Synced roots include:

- `profiles/*.json`
- `profiles/<profile>/agent/AGENTS.md`
- `agents/**`
- `settings/**`
- `models/**`
- `skills/**`
- `notes/**`
- `tasks/**`
- `projects/**`
- `pi-agent/sessions/**`

Machine-local runtime files such as auth, inbox state, deferred resumes, generated prompt materialization, and `bin/**` are not synced. Conversation attention read-state is synced so “needs review” follows across machines.

See [Sync Guide](./sync.md).

### `pa restart [--rebuild]`

Restart the daemon and managed web UI service.
Use `--rebuild` to rebuild repo packages first and blue/green redeploy the managed web UI, similar to the restart phase of `pa update` without pulling git changes.

### `pa update [--repo-only]`

Pull latest changes, refresh dependencies, rebuild packages, and restart background services.
If the managed web UI service is installed, `pa update` stages the next web UI release into the inactive blue/green slot, health-checks it on a candidate port, then swaps the service to the new slot.

## Common workflows

### Run one prompt with the active profile

```bash
pa tui -p "Summarize the latest inbox items"
```

### Open the UI and inspect background state

```bash
pa ui --open
pa daemon status
pa tasks list
pa runs list
pa inbox list --unread
```

### Create and validate a note node

```bash
pa note new repo-notes \
  --title "Repo Notes" \
  --summary "Useful notes about this repo" \
  --type reference
pa note lint
```

### Debug a scheduled task

```bash
pa tasks show morning-report
pa tasks logs morning-report --tail 120
pa tasks validate --all
```

### Configure sync on another device

```bash
git pull
pa restart --rebuild
pa sync setup --repo git@github.com:<you>/personal-agent-state.git --bootstrap
pa sync run
pa sync status
```

## JSON output

Machine-readable output is available for the main inspection commands.

Examples:

```bash
pa doctor --json
pa daemon status --json
pa tasks list --json
pa tasks show <id> --json
pa note list --json
pa inbox list --json
pa runs list --json
```

## Plain output

If you want simpler terminal output:

```bash
pa --plain ...
```

Or set:

- `PERSONAL_AGENT_PLAIN_OUTPUT=1`
- `NO_COLOR=1`

## Related docs

- [Decision Guide](./decision-guide.md)
- [Agent Tool Map](./agent-tool-map.md)
- [Getting Started](./getting-started.md)
- [How personal-agent works](./how-it-works.md)
- [Conversations](./conversations.md)
- [Runs](./runs.md)
- [Execution Targets](./execution-targets.md)
- [MCP](./mcp.md)
- [Web UI Guide](./web-ui.md)
- [Sync Guide](./sync.md)
- [Configuration](./configuration.md)
- [Troubleshooting](./troubleshooting.md)
