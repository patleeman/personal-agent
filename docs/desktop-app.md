# Desktop App

The Electron desktop app is the only supported Personal Agent operator UI.

It serves the React renderer through Electron's `personal-agent://app/` protocol instead of a loopback web server.

## Start locally

```bash
npm run desktop:start
```

`desktop:start` and `desktop:dev` currently both build the Electron shell and launch it through `packages/desktop/scripts/launch-dev-app.mjs`:

```bash
npm run desktop:dev
```

For packaged builds, launch `Personal Agent.app`.

## Runtime model

- Electron owns the local UI surface through `personal-agent://app/`.
- The renderer routes are `/conversations`, `/conversations/new`, `/conversations/:id`, `/knowledge`, `/automations`, `/automations/:id`, and `/settings`.
- The daemon still owns durable background behavior: runs, automations, wakeups, reminders, and companion pairing.
- The companion API still exposes HTTP/WebSocket on its configured port because phones and Tailnet clients need a public endpoint.
- The desktop app consumes server-pushed app events for sessions, runs, tasks, daemon status, and invalidation; API snapshots are the fallback when the event stream is not available.

## Layout modes

The desktop top bar has a layout selector:

- **Compact** keeps the classic left sidebar plus one main content pane.
- **Workbench** applies to conversation routes and adds resizable panes for the transcript, the open Knowledge note, and the Knowledge file explorer/open-files rail.

Use `Cmd+Option+\` on macOS, or `Ctrl+Alt+\` elsewhere, to toggle between Compact and Workbench. It sits with the related layout shortcuts: `Cmd/Ctrl+\` toggles the left sidebar and `Cmd/Ctrl+Shift+\` toggles the right rail.

The right-side workbench rail includes Knowledge, File Explorer, Diffs when the conversation has saved checkpoint diffs, Artifacts when present, and Browser. Browser opens an Electron-owned embedded web view in the workbench pane with simple navigation controls. Closing the Browser deactivates and hides that conversation's embedded view instead of leaving it as the active browser context. Right-click inside the browser and choose “Comment on this” to attach a targeted browser comment to the composer; it is sent as prompt context with selector, role/name, text, nearby text, and viewport metadata.

Diffs are conversation-scoped and replace the old checkpoint diff modal. Opening a checkpoint review switches the conversation to Workbench → Diffs, selects that diff, and renders the existing diff viewer in the workbench pane while the right rail lists all conversation diffs newest-first.

Workbench Browser sessions are scoped to the conversation. Switching conversations hides the previous conversation's webview and restores the selected conversation's webview, matching the workbench file/explorer model instead of using one global browser.

Desktop conversations expose agent tools for that same embedded browser only while that conversation's Browser workbench view is active: `browser_snapshot`, `browser_cdp`, and `browser_screenshot`. These tools are for shared user/agent communication around the visible Workbench Browser: Patrick can show a page, comment on an element, and let the agent inspect or act on that same page. They are not the default harness for autonomous development validation. Closing/deactivating the Browser removes those tools from the next model turn, and stale tool calls fail instead of reopening or recreating the browser implicitly. `browser_cdp` is a thin Chrome DevTools Protocol command surface for direct browser control; it accepts either one raw object like `{ "method": "Runtime.evaluate", "params": { "expression": "document.title", "returnByValue": true } }` or an array of command objects executed sequentially.

Agents should default to `browser_snapshot` for page understanding and navigation because it is more efficient and gives refs/selectors. Use `browser_screenshot` when visual layout or image/canvas-heavy content matters.

The embedded browser tracks a revision counter. When Patrick changes the page after the agent's last `browser_snapshot`, the next prompt injects `browser-changed-since-snapshot` context so the agent knows its old page observation is stale and should snapshot again.

The built-in Browser is the product UI communication surface. The `agent-browser` CLI remains a separate development/validation automation tool for agents; do not expose its snapshot/action controls in the normal Browser tab. See [Built-in Workbench Browser](../internal-skills/browser/INDEX.md) for agent-facing behavior and implementation guidance.

Workbench stores its mode and pane widths in browser-local layout preferences. Reset them from Settings → Browser local state → “Reset layout + reload”.

## Validation

For desktop UI work, run the desktop app and validate with agent-browser through the repo wrapper:

```bash
npm run ab:run -- --session desktop-check --command "ab open personal-agent://app/ && ab wait 1000 && ab snapshot -i"
```

## Related docs

- [Daemon](./daemon.md)
- [Command-Line Guide](./command-line.md)
- [Agent Browser](./agent-browser.md)
- [iOS Companion](./ios-companion.md)
