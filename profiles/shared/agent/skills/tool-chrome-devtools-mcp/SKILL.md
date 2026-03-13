---
name: tool-chrome-devtools-mcp
description: Use when asked to use Chrome DevTools MCP, attach an agent to a live Chrome session, inspect console/network/performance issues in Chrome, debug a browser tab with DevTools context, or install/configure chrome-devtools in mcp-cli.
allowed-tools: Bash(mcp-cli:*), Bash(npx chrome-devtools-mcp:*), Bash(open:*)
---

# Chrome DevTools MCP via mcp-cli

Use `mcp-cli` with `chrome-devtools` from `~/.config/mcp/mcp_servers.json`.

Prefer this over generic browser automation when the user explicitly wants Chrome DevTools context: console messages, network requests, performance traces, DOM snapshots, or reuse of an already-open Chrome session. For generic site automation or Electron app workflows, consider `tool-agent-browser`.

## Verify prerequisites

1. `which mcp-cli`
2. `mcp-cli --version`
3. `node --version` (Chrome DevTools MCP requires Node.js v20.19+)
4. `google-chrome --version`
   - On macOS, fallback to:
     - `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --version`

## Install / setup if missing

If `mcp-cli info chrome-devtools` fails because the server is not configured, add this entry to `~/.config/mcp/mcp_servers.json`.
If the file already exists, merge just the `chrome-devtools` entry into the existing `mcpServers` map; do not overwrite other servers.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--autoConnect"
      ]
    }
  }
}
```

Then verify:

```bash
mcp-cli info chrome-devtools
```

Optional hardening:
- Add `--no-usage-statistics` to opt out of Google usage statistics.
- Add `--no-performance-crux` to prevent performance tools from sending trace URLs to the CrUX API.
- Create a second entry such as `chrome-devtools-isolated` with `--isolated` when you want a clean temporary Chrome profile instead of a live-session attach.

If `mcp-cli` itself is missing, ask the user to install their local `mcp-cli` first, then continue with the server config above. Do not invent a package-manager command unless you can verify it in the current environment.

## Live-session attach with `--autoConnect`

`--autoConnect` is the best default when the user wants the agent to debug the same Chrome window/profile they already have open.

Requirements:
- Chrome 144+
- A running local Chrome instance
- Remote debugging enabled in Chrome

User steps:
1. Start Chrome.
2. Open `chrome://inspect/#remote-debugging`.
3. Enable remote debugging and allow incoming debugging connections.
4. Keep Chrome running.
5. On first attach, Chrome will show a permission dialog. Tell the user to click **Allow**.

Notes:
- `--autoConnect` attaches to the default Chrome profile/channel selected by the server.
- The server can inspect all open windows in that chosen profile.
- Chrome shows the “Chrome is being controlled by automated test software” banner while the session is active.
- If the first real tool call appears to hang, check whether Chrome is waiting on the permission dialog.

## Fallback: manual remote-debugging port

If `--autoConnect` is unavailable or the environment needs an explicit port, use `--browser-url=http://127.0.0.1:9222` instead.

Server config example:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--browser-url=http://127.0.0.1:9222"
      ]
    }
  }
}
```

Then start Chrome separately with a non-default user data dir and remote debugging port enabled. Example macOS command:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-devtools-mcp-profile
```

Use this when:
- The agent is sandboxed and cannot launch Chrome itself.
- The user wants a dedicated debug profile instead of their everyday browser profile.
- Auto-connect is not working in the local Chrome build.

## Core workflow

1. Verify the server:
   - `mcp-cli info chrome-devtools`
2. Inspect available tools:
   - `mcp-cli -d info chrome-devtools`
3. Inspect a specific tool before calling it:
   - `mcp-cli info chrome-devtools <toolName>`
4. Call the tool:
   - `mcp-cli call chrome-devtools <toolName> '{"key":"value"}'`
   - Or `echo '{"key":"value"}' | mcp-cli call chrome-devtools <toolName>`

## Useful first calls

```bash
# Confirm connectivity and see current tabs
mcp-cli call chrome-devtools list_pages '{}'

# Open a page in the connected Chrome instance
mcp-cli call chrome-devtools new_page '{"url":"https://developers.chrome.com"}'

# Capture a DOM/accessibility snapshot
mcp-cli call chrome-devtools take_snapshot '{}'

# Inspect console output
mcp-cli call chrome-devtools list_console_messages '{}'

# Inspect recent network requests
mcp-cli call chrome-devtools list_network_requests '{"pageSize":10}'

# Run a quick performance trace
mcp-cli call chrome-devtools performance_start_trace '{"reload":true,"autoStop":true}'
```

## Common task patterns

### Investigate a broken page already open in Chrome

1. Ensure Chrome is open and remote debugging is enabled.
2. `mcp-cli call chrome-devtools list_pages '{}'`
3. If needed, `mcp-cli call chrome-devtools select_page '{"pageId":<id>,"bringToFront":true}'`
4. Use:
   - `take_snapshot`
   - `list_console_messages`
   - `list_network_requests`
   - `get_network_request`

### Analyze a console error

1. `mcp-cli call chrome-devtools list_console_messages '{}'`
2. `mcp-cli call chrome-devtools get_console_message '{"msgid":<id>}'`
3. Use `evaluate_script` or `take_snapshot` to inspect surrounding state.

### Diagnose a failing network request

1. `mcp-cli call chrome-devtools list_network_requests '{"pageSize":20}'`
2. Identify the relevant request id.
3. `mcp-cli call chrome-devtools get_network_request '{"reqid":<id>}'`

### Capture a screenshot or artifact

```bash
mcp-cli call chrome-devtools take_screenshot '{"fullPage":true,"filePath":"./tmp/page.png"}'
mcp-cli call chrome-devtools take_snapshot '{"filePath":"./tmp/snapshot.json"}'
```

## Practical tips

- Always inspect a tool schema with `mcp-cli info chrome-devtools <toolName>` before complex calls.
- `mcp-cli call ...` returns JSON on stdout; use `jq` when extracting fields.
- Prefer focused debugging first: current page, current console messages, recent requests, then deeper tracing.
- If the user wants to reuse login/session state, prefer `--autoConnect`.
- If the user wants isolation or is debugging sign-in detection issues, prefer a separate profile or the manual `--browser-url` route.
- Warn users that the MCP server can inspect and modify the connected Chrome session, including authenticated pages.

## References

- Blog: https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session
- README: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Tool reference: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md
