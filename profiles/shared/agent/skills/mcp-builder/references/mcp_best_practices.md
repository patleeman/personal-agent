# MCP Best Practices

## Server Naming
- Python: `{service}_mcp` (e.g., `github_mcp`)
- TypeScript: `{service}-mcp-server` (e.g., `github-mcp-server`)

## Tool Naming
- Format: `{service}_{action}_{resource}`
- Use snake_case
- Examples: `slack_send_message`, `github_list_repos`, `jira_create_issue`

## Response Formats

**Markdown** (human-readable):
- Use headers, lists, formatting
- Convert timestamps to readable format
- Show display names with IDs: `@john.doe (U123456)`
- Omit verbose metadata

**JSON** (machine-readable):
- Complete structured data
- All fields and metadata
- Consistent field names

## Pagination

Always include:
```json
{
  "total": 100,
  "count": 20,
  "offset": 0,
  "items": [...],
  "has_more": true,
  "next_offset": 20
}
```

Default limit: 20-50 items. Max: 100.

## Transport Options

| Transport | Use Case |
|-----------|----------|
| Streamable HTTP | Remote servers, web services, multi-client |
| stdio | Local tools, CLI, subprocess integration |

## Tool Annotations

```typescript
annotations: {
  readOnlyHint: true,      // Doesn't modify state
  destructiveHint: false,  // Doesn't delete data
  idempotentHint: true,    // Repeated calls safe
  openWorldHint: false     // Doesn't contact external entities
}
```

## Security

- Use OAuth 2.1 or API keys in environment variables
- Sanitize all inputs
- Implement DNS rebinding protection for local HTTP
- Validate origins
- Never expose implementation details in errors

## Error Handling

Use standard JSON-RPC error codes. Provide helpful messages:

```
"Error: Resource not found. Please check the ID is correct."
"Error: Permission denied. You don't have access to this resource."
"Error: Rate limit exceeded. Please wait before making more requests."
```

## Character Limits

Set a CHARACTER_LIMIT constant (e.g., 25000) and truncate with message:
```
"Response truncated from 500 to 250 items. Use 'offset' parameter to see more."
```
