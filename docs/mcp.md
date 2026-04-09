# MCP

`personal-agent` can inspect and call configured MCP servers through `pa mcp` and through Pi's MCP-aware runtime.

Use MCP when the capability should come from a configured external tool server rather than from a built-in local tool or ad hoc shell command.

## When to use it

Good fits:

- SaaS or internal systems already exposed through MCP
- authenticated remote tool access
- probing server/tool schemas before use
- reusing one tool contract across CLI and conversations

Do not reach for MCP when a dedicated first-party runtime tool already exists.

## Server types

An MCP server can be configured as either:

- **stdio** — a local command the client starts
- **remote** — an HTTP/SSE MCP endpoint

## Config discovery

By default, MCP config is searched in this order:

1. `./mcp_servers.json` in the current working directory
2. `~/.mcp_servers.json`
3. `~/.config/mcp/mcp_servers.json`

You can also pass an explicit config path with `-c` / `--config`.

## CLI commands

```bash
pa mcp list
pa mcp list --probe
pa mcp info <server>
pa mcp info <server>/<tool>
pa mcp grep '*jira*'
pa mcp call <server> <tool> '{}'
pa mcp auth <server>
pa mcp logout <server>
```

`pa mcp call` reads JSON from stdin if the JSON argument is omitted.

## OAuth and auth state

Remote MCP servers can use OAuth.

- `pa mcp auth <server>` triggers login or connectivity validation
- `pa mcp logout <server>` clears stored OAuth state for that server

Auth state is machine-local, not part of the shared vault.

## Practical flow

1. `pa mcp list --probe`
2. `pa mcp info <server>/<tool>`
3. `pa mcp auth <server>` if needed
4. call the tool from the CLI or let the conversation runtime use it

## Related docs

- [Command-Line Guide (`pa`)](./command-line.md)
- [Tools page in the Web UI](./web-ui.md)
