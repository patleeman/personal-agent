# MCP

`personal-agent` can inspect and call configured MCP servers through `pa mcp` and through Pi's runtime.

Use MCP when the capability should come from an external tool server instead of a built-in local tool.

## Config discovery

Without an explicit `--config`, MCP config is resolved in this order:

1. `./mcp_servers.json`
2. `~/.mcp_servers.json`
3. `~/.config/mcp/mcp_servers.json`

When `pa` materializes the runtime, it also merges any skill-bundled `mcp.json` manifests from the active skill directories. Explicit user config wins on name conflicts.

## Server types

- `stdio` — local command started by the client
- `remote` — HTTP/SSE MCP endpoint

## Command map

```bash
pa mcp list --probe
pa mcp info <server>
pa mcp info <server>/<tool>
pa mcp grep '*jira*'
pa mcp call <server> <tool> '{}'
pa mcp auth <server>
pa mcp logout <server>
```

`pa mcp call` reads JSON from stdin when the JSON argument is omitted.

## Skill-bundled MCP manifests

A skill can ship an `mcp.json` next to `SKILL.md`:

```text
<vault-root>/skills/<skill>/
├── SKILL.md
└── mcp.json
```

Example:

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "pa",
      "args": ["mcp", "serve", "atlassian"]
    }
  }
}
```

That keeps workflow instructions and the MCP wrapper together.

## OAuth and auth state

Remote MCP servers can use OAuth.

- `pa mcp auth <server>` starts login or validates connectivity
- `pa mcp logout <server>` clears stored auth state

Auth state is machine-local and should not be committed into `<vault-root>`.

## Practical flow

1. `pa mcp list --probe`
2. `pa mcp info <server>/<tool>`
3. `pa mcp auth <server>` if needed
4. call the tool directly or let the runtime use it

## Related docs

- [Command-Line Guide (`pa`)](./command-line.md)
- [Configuration](./configuration.md)
