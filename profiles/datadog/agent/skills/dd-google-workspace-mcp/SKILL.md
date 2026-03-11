---
name: dd-google-workspace-mcp
description: Use when asked to access Google Drive, Google Sheets, or Google Docs via Datadog's Google Workspace MCP, or to troubleshoot google-workspace MCP setup/auth with mcp-cli.
---

# Google Workspace MCP via mcp-cli

Use `mcp-cli` with `google-workspace` from `~/.config/mcp/mcp_servers.json`.

Reference: https://datadoghq.atlassian.net/wiki/spaces/EITAI/pages/6301646867/Google+Workspace+MCP+Server

## Workflow

1. **Verify CLI + server config**
   - `which mcp-cli`
   - `mcp-cli --version`
   - `mcp-cli info google-workspace`

2. **Authenticate (if needed)**
   - First call may trigger browser OAuth via `mcp-remote`.
   - Sign in with your `datadoghq.com` Google account.
   - If auth fails, rerun the call and re-authorize.

3. **Discover tools**
   - `mcp-cli info google-workspace`
   - `mcp-cli -d info google-workspace`

4. **Inspect tool schema before calling**
   - `mcp-cli info google-workspace <toolName>`

5. **Call tools**
   - `mcp-cli call google-workspace <toolName> '{"key":"value"}'`
   - For complex args:
     - `echo '{"key":"value"}' | mcp-cli call google-workspace <toolName>`

6. **Sanity check**
   - `mcp-cli call google-workspace ping '{}'`

## Server Configuration (if missing)

Add to `~/.config/mcp/mcp_servers.json`:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://google-workspace-mcp-server-834963730936.us-central1.run.app/mcp"
      ]
    }
  }
}
```

## Common tools

### Drive
- `search_files`
- `get_file_metadata`
- `get_file_content`
- `list_folder_contents`
- `create_file`

### Sheets
- `read_sheet`
- `write_sheet`
- `append_rows`
- `create_spreadsheet`
- `get_spreadsheet_metadata`

### Docs
- `read_document`
- `create_document`
- `append_text`

### Utility
- `ping`

## Example calls

```bash
# Check connectivity/auth
mcp-cli call google-workspace ping '{}'

# Search Drive
mcp-cli call google-workspace search_files '{"query":"roadmap","max_results":5}'

# Read a sheet range
mcp-cli call google-workspace read_sheet '{"spreadsheet_id":"<sheet-id>","range":"Sheet1!A1:C20"}'

# Read a Google Doc
mcp-cli call google-workspace read_document '{"document_id":"<doc-id>"}'

# Create a Google Doc
mcp-cli call google-workspace create_document '{"title":"Weekly Notes","body":"Draft notes"}'
```

## Practical tips

- When a user gives a Google URL, extract the resource ID from it:
  - Docs: `/document/d/<id>/...`
  - Sheets: `/spreadsheets/d/<id>/...`
  - Drive files: `/file/d/<id>/...`
- Prefer scoped reads first: small `max_results`, narrow sheet ranges, specific file IDs.
- For write operations, confirm the target file/document and intended changes before mutating anything.

## Notes

- Current verified tool list is **Drive + Sheets + Docs + ping**. Despite broader Google Workspace naming, this server does **not** currently expose Gmail or Calendar tools.
- Access is restricted to `datadoghq.com` Google Workspace accounts.
- OAuth is handled by the remote server through `mcp-remote`.
- `mcp-cli` output is JSON on stdout; use `jq` when you need to extract fields.

## Example user intents

- "Search Drive for onboarding docs about MCP"
- "Read this Google Doc and summarize it"
- "Append these rows to a sheet"
- "Create a new doc with these meeting notes"
- "Why is google-workspace MCP auth failing?"
