# Native UI Automation

`personal-agent` can drive visible native macOS app windows through the built-in `computer_use` tool.

This is the right path when shell tools, file edits, and browser automation are not enough because the task depends on a **real visible macOS app window**.

For the agent-facing workflow, read the built-in internal skill:

- [Computer Use](../internal-skills/computer-use/INDEX.md)

## When to use it

Use native UI automation for:

- TextEdit, Finder, Safari, Mail, and other native macOS apps
- macOS dialogs, sheets, and menus that are not exposed through a browser DOM
- visual inspection of a native app window before deciding what to do next
- lightweight manual smoke interaction against a visible app surface

Prefer other paths when possible:

- use `agent-browser` for web apps and Electron apps with browser-accessible DOM/CDP state
- use shell or file tools when the task does not actually need a visible app window
- use dedicated automated tests when you need repeatable CI coverage rather than ad hoc interaction

## Runtime surface

The built-in tool is:

- `computer_use`

Use it as an observe/action loop:

1. `action: "observe"` to capture or retarget a window and get accessibility `elementId`s
2. prefer `elementId`-targeted `click`, `type`, `set_value`, or `secondary_action`
3. fall back to coordinates only when accessibility targeting is not good enough
4. use `keypress`, `drag`, `scroll`, and `wait` when the workflow really needs them

`observe` is the expensive, state-inspection step. Other actions return a fresh screenshot, but run `observe` again when you need fresh element IDs for the new UI state.

## Current scope

The current implementation targets:

- macOS
- visible windows
- direct interaction in the current user session
- accessibility-first interaction with coordinate fallback

It is meant for practical interactive control, not invisible background desktop automation.

## Required permissions

Native UI automation needs:

- Accessibility permission
- Screen Recording permission

Grant them to the app or terminal process that is running `personal-agent`.

## Related docs

- [Computer Use](../internal-skills/computer-use/INDEX.md)
- [Web UI Guide](./web-ui.md)
- [Electron desktop app](./electron-desktop-app-plan.md)
