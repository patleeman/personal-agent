# MCP

`personal-agent` can inspect and call configured MCP servers through `pa mcp` and the runtime's MCP-aware tool layer.

Use MCP when the capability should come from a configured external tool server rather than from built-in local tools or ad hoc shell commands.

## When to use MCP

Good fits:

- SaaS or internal systems exposed through MCP servers
- authenticated remote tool access
- discovering server tools and schemas before calling them
- using one shared tool contract across conversations and CLI inspection

Do not reach for MCP when a dedicated first-party tool already exists in the agent runtime for the task.

## Core model

An MCP server is configured as either:

- **stdio** — a local command started by the client
- **remote** — an HTTP/SSE MCP endpoint

`personal-agent` can:

- list configured servers
- probe server tool metadata
- inspect one server or one tool
- call a tool directly
- manage OAuth login/logout for supported remote servers

## CLI commands

```bash
pa mcp list
pa mcp list --probe
pa mcp info <server>
pa mcp info <server>/<tool>
pa mcp grep '*jira*'
pa mcp call <server> <tool> '{"key":"value"}'
pa mcp auth <server>
pa mcp logout <server>
```

`pa mcp list` is config-only by default. Use `--probe` when you want to connect and fetch tool metadata.

## Config discovery

By default, MCP config is discovered from paths such as:

- `./mcp_servers.json`
- `~/.mcp_servers.json`
- `~/.config/mcp/mcp_servers.json`

The config contains an `mcpServers` object describing the available servers.

## Remote auth

Remote MCP servers can require OAuth.

`pa mcp auth <server>` starts the login flow using the server's configured callback information. `pa mcp logout <server>` removes the stored auth state for that server.

## Web UI relationship

The Web UI **Tools** page is the inspection surface for available tools, dependent CLI tools, and configured MCP servers.

Use it when you want to inspect the configured tool environment visually rather than through the CLI.

## Practical rule of thumb

Use MCP when the thing you need already exists as a configured tool server.

Use local agent tools when the runtime already exposes a direct capability.

## Related docs

- [Command-Line Guide (`pa`)](./command-line.md)
- [Web UI Guide](./web-ui.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities.md)
