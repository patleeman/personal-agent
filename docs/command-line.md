# Command-Line Guide (`pa`)

`pa` is the command-line entry point for `personal-agent`.

Use it to launch Pi with the resolved runtime and to manage local machine services around that runtime.

## Command map

Top-level commands:

```text
pa status
pa tui
pa install
pa profile
pa doctor
pa restart
pa update
pa daemon
pa ui
pa mcp
```

Use `pa help <command>` for exact flags.

## Launch Pi

```bash
pa tui
pa tui -- --model openai-codex/gpt-5.4-mini
pa tui -- -p "summarize this repo"
```

Everything after `--` is passed through to Pi.

## Inspect local health

```bash
pa status
pa doctor
```

Use these before debugging anything more specific.

## Install package sources

```bash
pa install https://github.com/user/pi-package
pa install npm:@scope/package@1.2.3
pa install --profile assistant ./my-package
pa install --local ./my-package
```

`--profile` writes into that profile's durable settings. `--local` writes into the machine-local overlay.

## Profile commands

```bash
pa profile list
pa profile show
pa profile use <name>
```

## Web UI commands

```bash
pa ui
pa ui status
pa ui open
pa ui foreground --open
pa ui logs --tail 120
pa ui pairing-code
pa ui install
pa ui start
pa ui stop
pa ui restart
pa ui uninstall
```

## Daemon commands

```bash
pa daemon
pa daemon status
pa daemon start
pa daemon stop
pa daemon restart
pa daemon logs
pa daemon service install
pa daemon service status
pa daemon service uninstall
```

## MCP commands

```bash
pa mcp list --probe
pa mcp info <server>
pa mcp info <server>/<tool>
pa mcp grep '*jira*'
pa mcp call <server> <tool> '{}'
pa mcp auth <server>
pa mcp logout <server>
```

## What no longer has a public CLI workflow

Do not expect these as primary public commands:

- `pa runs`
- `pa tasks`

Use the built-in runtime tools instead:

- `run`
- `scheduled_task`
- `conversation_queue`
- `reminder`

Use the web UI for visual inspection of automations and owned run history.

## Practical flows

### Start a local operator session

```bash
pa doctor
pa ui foreground --open
```

### Bring up background behavior

```bash
pa daemon start
pa ui install
```

### Inspect MCP before use

```bash
pa mcp list --probe -d
```

## Related docs

- [Getting Started](./getting-started.md)
- [Web UI Guide](./web-ui.md)
- [Daemon](./daemon.md)
- [Configuration](./configuration.md)
- [MCP](./mcp.md)
