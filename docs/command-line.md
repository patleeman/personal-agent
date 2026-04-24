# Command-Line Guide (`pa`)

`pa` is the command-line entry point for `personal-agent`.

Use it to launch Pi with the resolved runtime and to manage local machine services around that runtime.

## Command map

Top-level commands:

```text
pa status
pa tui
pa install
pa doctor
pa restart
pa update
pa daemon
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
pa install --local ./my-package
```

`--local` writes into the machine-local overlay. The normal install target is the shared runtime config.

## Desktop app

The desktop app is the UI. Start it directly during development:

```bash
npm run desktop:start
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

## Practical flows

### Start a local operator session

```bash
pa doctor
npm run desktop:start
```

### Bring up background behavior

```bash
pa daemon start
```

### Inspect MCP before use

```bash
pa mcp list --probe -d
```

## Related docs

- [Getting Started](./getting-started.md)
- [Desktop App](./desktop-app.md)
- [Daemon](./daemon.md)
- [Configuration](./configuration.md)
- [MCP](./mcp.md)
