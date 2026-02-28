---
name: dd-odp-mcp
description: Use when asked to query Datadog ODP data via mcp-cli (schemas, SQL on BeagleSQL/TrinoSQL, sample data, ODP knowledge, formulas/functions, semantic core mapping, service metadata, or logical dataset generation).
---

# ODP MCP via mcp-cli

Use `mcp-cli` with `odp` (prod) or `odp-staging` from `~/.config/mcp/mcp_servers.json`.

Reference: https://datadoghq.atlassian.net/wiki/spaces/ODP/pages/5330895035/ODP+MCP+Server

## Workflow

1. **Verify CLI + server config**
   - `which mcp-cli`
   - `mcp-cli --version`
   - `mcp-cli info odp`
   - `mcp-cli info odp-staging`

2. **Authenticate (if needed)**
   - First call may trigger OAuth in browser via `mcp-remote`.
   - If auth fails, rerun and re-authorize.

3. **Discover tools**
   - `mcp-cli info odp`
   - `mcp-cli -d info odp`

4. **Inspect tool schema before calling**
   - `mcp-cli info odp <toolName>`

5. **Call tools**
   - `mcp-cli call odp <toolName> '{"key":"value"}'`
   - For complex args:
     - `echo '{"key":"value"}' | mcp-cli call odp <toolName>`

## Server Configuration (if missing)

Add to `~/.config/mcp/mcp_servers.json`:

```json
{
  "mcpServers": {
    "odp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://odp-mcp-server.mcp.us1.prod.dog/internal/unstable/odp-mcp-server/mcp"
      ]
    },
    "odp-staging": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://odp-mcp-server.mcp.us1.staging.dog/internal/unstable/odp-mcp-server/mcp"
      ]
    }
  }
}
```

## Common Tools

- `get-catalogs`
- `get-schemas-by-catalog`
- `get-tables-by-schema`
- `get-table-schema`
- `sample_data`
- `search_odp_knowledge`
- `query_tool`
- `query_formulas_and_functions`
- `Otel_Mapping`, `Otel_MetricsFamilies`
- `get_services`, `get_service_detail`
- `get-evp-tracks` and `koutris_*` tools
- `generate_logical_dataset`

## Example Calls

```bash
# List catalogs (default engine is BeagleSQL)
mcp-cli call odp get-catalogs '{"org_id":"<org_id>"}'

# List schemas for TrinoSQL catalog
mcp-cli call odp get-schemas-by-catalog '{"org_id":"<org_id>","engine":"TrinoSQL","catalog":"iceberg"}'

# Inspect schema + sample rows from a table
mcp-cli call odp sample_data '{"org_id":"<org_id>","type":"table","name":"resources.k8s_pod"}'

# Search query examples before writing SQL
mcp-cli call odp search_odp_knowledge '{"query":"error logs for service"}'

# Execute SQL query
mcp-cli call odp query_tool '{"org_id":"<org_id>","type":"TrinoSQL","query":"SELECT 1 LIMIT 1"}'
```

## Notes

- ODP MCP is marked experimental in docs; tool names/behavior can change.
- Most tools require `org_id`; ask user for it if not provided.
- For `query_tool`, always use `LIMIT` and narrow time windows.
- Prefer read-only tooling unless user explicitly asks for mutation/generation actions.
- Validate parameters with `mcp-cli info odp <toolName>` before calls.
