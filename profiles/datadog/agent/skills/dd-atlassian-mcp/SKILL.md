---
name: dd-atlassian-mcp
description: Use when asked to query or update Jira/Confluence via mcp-cli + Atlassian MCP, or when a user mentions atlassian-mcp, Confluence CLI search, or Jira CLI edits.
---

# Atlassian MCP via mcp-cli

Use `mcp-cli` with the `atlassian` server from `~/.config/mcp/mcp_servers.json`.

## Workflow

1. **Verify CLI is available**
   - `which mcp-cli`
   - `mcp-cli --version`

2. **Verify Atlassian server is configured**
   - `mcp-cli info atlassian`
   - If missing, add this server in `~/.config/mcp/mcp_servers.json`:
     - command: `npx`
     - args: `-y mcp-remote@latest https://mcp.atlassian.com/v1/mcp`

3. **Authenticate (if needed)**
   - First tool call may open browser OAuth via `mcp-remote`.
   - If auth is stale, rerun the call and complete OAuth again.

4. **Discover tools**
   - `mcp-cli info atlassian`
   - Use descriptions: `mcp-cli -d info atlassian`

5. **Inspect parameters**
   - `mcp-cli info atlassian <toolName>`
   - Build JSON arguments from the tool schema.

6. **Call the tool**
   - `mcp-cli call atlassian <toolName> '{"key":"value"}'`
   - For complex JSON, pipe via stdin:
     - `echo '{"key":"value"}' | mcp-cli call atlassian <toolName>`

## Common Actions

### Resolve Cloud ID (required for many tools)
```
mcp-cli call atlassian getAccessibleAtlassianResources '{}'
```
- Pick the `cloudId` from the response (use the Confluence one for Confluence search).

### Search Confluence (CQL)
```
mcp-cli call atlassian searchConfluenceUsingCql '{"cloudId":"<id>","cql":"text ~ \"datadog\"","limit":5}'
```

### Search Jira (JQL)
```
mcp-cli call atlassian searchJiraIssuesUsingJql '{"cloudId":"<id>","jql":"project = ABC order by updated desc","limit":5}'
```

### Cross-system search (Rovo Search)
```
mcp-cli call atlassian search '{"query":"datadog"}'
```
- Results can include both Jira and Confluence. Filter by `id` prefix (`ari:cloud:confluence` vs `ari:cloud:jira`).

### Read a Confluence page
```
mcp-cli call atlassian getConfluencePage '{"cloudId":"<id>","pageId":"123456"}'
```

### Edit a Jira issue
```
mcp-cli call atlassian editJiraIssue '{"cloudId":"<id>","issueIdOrKey":"PROJ-123","fields":{"summary":"New title"}}'
```
- Confirm intent with the user before write operations.

## Configuration Notes

- Remote endpoint: `https://mcp.atlassian.com/v1/mcp`
- Transport is handled by `mcp-remote` in the server config.
- Keep calls scoped and use small limits (`limit: 5-10`) to reduce output and token use.

## Output Handling

- `mcp-cli call ...` returns JSON on stdout.
- Use `jq` to extract structured fields when needed.
