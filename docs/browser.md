# Browser

The built-in Browser is an Electron-owned webview embedded in the desktop app's Workbench rail. It provides a shared visual context for the user and agent — both see the same page.

## Opening the Browser

In Workbench mode, open the Browser tab in the right rail. The browser loads and displays web pages alongside the conversation transcript. Close it with the X button, which hides the browser pane.

```
┌─────────────────────────────────────────────────┐
│ Conversation transcript    │ Browser tab         │
│                            │                     │
│ User: What's on this page?│ [URL bar]           │
│                            │ ┌─────────────────┐ │
│ Agent: Let me check...     │ │                 │ │
│                            │ │  Web page       │ │
│                            │ │  content        │ │
│                            │ └─────────────────┘ │
└─────────────────────────────────────────────────┘
```

## Browser Comments

Right-click any element on the page to attach a comment. A context menu appears with "Add comment." The comment text is included in the next prompt, giving the agent context about what part of the page the user is looking at.

Comments are scoped to the conversation. Each comment includes:

- The selected text or element description
- The comment text entered by the user

## Agent Tools

When the browser is active for a conversation (the Browser pane is open), the agent can use these tools:

| Tool                 | What it does                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `browser_snapshot`   | Get a text representation of the current page: DOM structure, visible text, and metadata          |
| `browser_screenshot` | Capture a screenshot of the current page as an image attachment                                   |
| `browser_cdp`        | Execute arbitrary Chrome DevTools Protocol commands (e.g., evaluate JavaScript, get network logs) |

### Tool availability

The browser tools are automatically registered when the Browser pane is open for the conversation. If the browser is closed or another conversation is active without a browser, the tools return an error:

```
Workbench Browser is not active for this conversation.
Open the Browser workbench panel before using browser tools.
```

### CDP commands

The `browser_cdp` tool accepts any valid CDP command:

```json
{
  "conversationId": "abc123",
  "command": {
    "method": "Runtime.evaluate",
    "params": {
      "expression": "document.title"
    }
  },
  "continueOnError": false
}
```

## Use Cases

- **Page analysis** — The user browses a page and asks the agent to analyze its content, structure, or styling
- **Form filling** — The user navigates to a form and the agent helps fill it out
- **Debugging** — The user inspects a page issue and the agent examines network requests or console output via CDP
- **Research** — The user and agent explore documentation or references together

## Relationship to agent-browser CLI

The older `agent-browser` CLI tool is a separate development/validation tool that uses Playwright. It is not integrated with the desktop app and is not a supported feature for end users. The wrapper scripts `npm run ab:run` and `npm run ab:cleanup` exist in this repo for development use only.

For desktop QA, launch the testing app with a remote debugging port and quit-confirmation bypass so automated cleanup cannot get stuck behind the quit dialog:

```bash
npm run desktop:dev -- --remote-debugging-port=9222 --no-quit-confirmation
```

After QA, close `Personal Agent Testing.app` and run `npm run ab:cleanup -- --session <name>` for any named wrapper session used during the check.

| Feature       | Built-in Browser           | agent-browser CLI   |
| ------------- | -------------------------- | ------------------- |
| UI            | Workbench rail in Electron | Terminal/Playwright |
| Session       | Scoped to conversation     | Named CLI sessions  |
| Comments      | Right-click UI             | Not supported       |
| Accessibility | End-user feature           | Dev tool only       |
