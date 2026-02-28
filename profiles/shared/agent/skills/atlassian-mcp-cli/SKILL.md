---
name: atlassian-mcp-cli
description: Use when asked to query or update Jira/Confluence via the atlassian-mcp CLI, or when a user mentions atlassian-mcp, Confluence CLI search, or Jira CLI edits.
---

# Atlassian MCP CLI

Use the installed `atlassian-mcp` CLI via the Bash tool. It wraps Atlassian’s MCP server for Jira + Confluence.

## Workflow

1. **Verify CLI is available**
   - `which atlassian-mcp` or `atlassian-mcp version`

2. **Authenticate (if needed)**
   - `atlassian-mcp auth login`
   - To force re-auth: `atlassian-mcp auth clear` then `atlassian-mcp auth login`
   - Tokens live under `~/.mcp-auth`.

3. **Discover tools**
   - `atlassian-mcp tools --json`
   - Use `--long` to include descriptions.

4. **Inspect parameters**
   - `atlassian-mcp tools schema <toolName>`
   - Build JSON arguments based on the schema.

5. **Resolve Cloud ID (required for many tools)**
   - `atlassian-mcp call getAccessibleAtlassianResources --args '{}'`
   - Pick the `cloudId` from the response (use the Confluence one for Confluence search).
   - Optional: export `ATLASSIAN_CLOUD_ID=<id>` for reuse in your shell.

6. **Call the tool**
   - `atlassian-mcp call <toolName> --args '{"key":"value"}'`
   - Or `--args-file path/to/request.json`.

## Common Actions

### Search Confluence (CQL)
1) Get cloud ID
```
atlassian-mcp call getAccessibleAtlassianResources --args '{}'
```
2) Search
```
atlassian-mcp call searchConfluenceUsingCql --args '{"cloudId":"<id>","cql":"text ~ \"datadog\"","limit":5}'
```

### Search Jira (JQL)
```
atlassian-mcp call searchJiraIssuesUsingJql --args '{"cloudId":"<id>","jql":"project = ABC order by updated desc","limit":5}'
```

### Cross-system search (Rovo Search)
```
atlassian-mcp call search --args '{"query":"datadog"}'
```
- Results can include both Jira and Confluence. Filter by `id` prefix (`ari:cloud:confluence` vs `ari:cloud:jira`).

### Read a Confluence page
```
atlassian-mcp call getConfluencePage --args '{"cloudId":"<id>","pageId":"123456"}'
```

### Edit a Jira issue
```
atlassian-mcp call editJiraIssue --args '{"cloudId":"<id>","issueIdOrKey":"PROJ-123","fields":{"summary":"New title"}}'
```
- Confirm intent with the user before write operations.

## Configuration Notes

- Default server URL: `https://mcp.atlassian.com/v1/sse`
- Default Atlassian site: `https://datadoghq.atlassian.net` (overridable via `ATLASSIAN_URL` or `--atlassian-url`).
- Use `--server-url` to point at a different MCP server.
- `--log-level error` keeps output clean for parsing.

## Output Handling

- Tool output is JSON. Use `--limit` fields where available to keep responses small.
- If needed, pipe to `jq` or save to a file for parsing.
