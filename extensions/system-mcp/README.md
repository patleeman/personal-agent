# Mcp Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/mcp.md -->

# MCP

Personal Agent supports the Model Context Protocol (MCP) for integrating external tools, data sources, and services.

## Server Configuration

MCP servers are defined in `mcp_servers.json` or bundled with a skill in `mcp.json`.

For reusable workflows, the preferred shape is a skill package with `SKILL.md` plus `mcp.json`. This keeps the tool instructions and server config together, makes the MCP available whenever that skill is active, and avoids machine-local setup drift. Use standalone `mcp_servers.json` for personal one-off servers, local overrides, or servers that do not belong to a reusable skill.

The runtime searches for standalone MCP config in order:

1. Path from `MCP_CONFIG_PATH` environment variable
2. `<cwd>/mcp_servers.json`
3. `~/.mcp_servers.json`
4. `~/.config/mcp/mcp_servers.json`

Bundled skill MCP servers are merged into the discovered MCP config at runtime. If a bundled server and an explicit `mcp_servers.json` entry use the same server name, the explicit config wins.

### Local servers

Local servers are launched as subprocesses:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": {}
    },
    "custom-server": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

### Remote servers

Remote servers connect over HTTP/WebSocket:

```json
{
  "mcpServers": {
    "slack": {
      "type": "remote",
      "url": "https://mcp.slack.com/mcp",
      "oauth": {
        "clientId": "your-client-id"
      }
    }
  }
}
```

Remote servers may require OAuth authentication. The runtime handles the OAuth flow when configured.

### Skill-bundled servers

Skill packages can ship MCP server definitions alongside their workflow docs:

```text
<vault-root>/skills/<skill-name>/
├── SKILL.md
└── mcp.json
```

`mcp.json` uses the same server entry shape as `mcp_servers.json`:

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

Skill-bundled servers are useful when a skill depends on a specific MCP server. Keep secrets out of `mcp.json`; pass credentials through environment variables, OAuth, or local machine config instead.

## MCP Tool Reference

The `mcp` tool provides access to configured MCP servers:

| Action   | Parameters                                  | Description                                                                     |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `list`   | `probe?` (boolean)                          | List configured servers. When `probe` is true, fetches and displays their tools |
| `info`   | `server`, `tool?`                           | Inspect a server or a specific tool on a server                                 |
| `grep`   | `server`, `pattern`                         | Search for tools on a server by name pattern (supports `*` wildcards)           |
| `call`   | `server`, `tool`, `arguments` (JSON string) | Call a tool on an MCP server                                                    |
| `auth`   | `server`                                    | Start OAuth authentication for a remote server                                  |
| `logout` | `server`                                    | Clear stored authentication for a server                                        |

### Calling a tool

```json
{
  "action": "call",
  "server": "filesystem",
  "tool": "read",
  "arguments": "{\"path\":\"/path/to/file\"}"
}
```

## Authentication

### Local servers

Local servers authenticate through command-line arguments and environment variables defined in the server config entry.

### Remote servers

Remote servers use OAuth 2.0 with the authorization code flow:

1. The client initiates auth via the `mcp auth` action
2. The runtime opens a browser for the user to authorize
3. The OAuth callback is handled locally
4. Tokens are stored in the runtime config

OAuth state persists across restarts. Use `mcp logout` to clear stored credentials.

## Tool Availability

MCP server tools are available to the agent in any conversation. The agent discovers tools through the `mcp list` and `mcp grep` actions, then calls them with `mcp call`.

## Configuration Format

Full server entry format:

```typescript
{
  "mcpServers": {
    "server-name": {
      // Local server
      "command": "executable",
      "args": ["--flag", "value"],
      "env": { "VAR": "value" },

      // Remote server (alternative to command/args)
      "type": "remote",
      "url": "https://example.com/mcp",

      // Optional
      "oauth": {
        "clientId": "string"
      }
    }
  }
}
```

## Error Handling

- Missing servers return a clear error message
- Failed tool calls include the server's error output
- OAuth errors include guidance on configuring the client ID
- Server inspection reports stderr output on failure
