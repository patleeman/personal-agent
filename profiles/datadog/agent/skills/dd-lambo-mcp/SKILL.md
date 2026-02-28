---
name: dd-lambo-mcp
description: Use when asked about Lambo APIs/routes/route groups, rate limits, rate-limit proposals, or historical Lambo rate-limit trends. Uses the Lambo MCP server via mcp-cli.
---

# Lambo MCP via mcp-cli

Use `mcp-cli` with `lambo` (prod) or `lambo-staging` from `~/.config/mcp/mcp_servers.json`.

Reference: https://datadoghq.atlassian.net/wiki/spaces/API/pages/6141150208/Lambo+MCP+Server

## Workflow

1. **Verify CLI + server**
   - `which mcp-cli`
   - `mcp-cli --version`
   - `mcp-cli info lambo`
   - `mcp-cli info lambo-staging`

2. **Authenticate (if needed)**
   - First call may trigger OAuth in browser via `mcp-remote`.
   - If auth fails, rerun and re-authorize.

3. **Discover tools**
   - `mcp-cli info lambo`
   - `mcp-cli -d info lambo`
   - `mcp-cli grep "*lambo*"`

4. **Inspect tool schema before calling**
   - `mcp-cli info lambo <toolName>`

5. **Call tools**
   - `mcp-cli call lambo <toolName> '{"key":"value"}'`
   - For complex args:
     - `echo '{"key":"value"}' | mcp-cli call lambo <toolName>`

## Notes

- Prod endpoint: `https://lambo-mcp-server.mcp.us1.prod.dog/internal/mcp`
- Staging endpoint: `https://lambo-mcp-server.mcp.us1.staging.dog/internal/mcp`
- Server instructions mention `lambo://docs/confluence` for general docs/Q&A.
- Tool names differ slightly between prod and staging (example: `list_team_routes` vs `listTeamRoutes`). Run `mcp-cli info <server>` before calls.
- Keep requests scoped and use small limits to reduce output.
- Prefer read-only tools unless the user explicitly asks for mutation.

## Common tools

- `list_domains`
- `list_team_routes`
- `list_all_route_groups`
- `get_route_group`
- `get_rate_limit`
- `analyze_rate_limits`
- `analyze_team_rate_limits`
- `analyze_route_rate_limit_history`
- `analyze_rate_limit_proposal_trends`
- `analyze_rate_limit_override_proposal_trends`
- `list_rate_limit_proposals`
- `list_rate_limit_override_proposals`

## Example calls

```bash
mcp-cli call lambo list_domains '{}'
mcp-cli call lambo list_team_routes '{"team":"api-reliability"}'
mcp-cli call lambo analyze_team_rate_limits '{"team":"slo-app"}'
mcp-cli call lambo analyze_route_rate_limit_history '{"routePath":"/api/v2/timeseries"}'
# staging example
mcp-cli call lambo-staging list_domains '{}'
```

## Example user intents

- "List routes owned by team api-reliability"
- "Analyze rate limits for web-api domain"
- "Show rate limit history for /api/v2/timeseries"
- "What is the default rate limit in lambo?"
