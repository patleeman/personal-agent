# Browser extension URL capture

The browser extension is the lightweight capture surface for getting page and link URLs from Chrome or Firefox into the Personal Agent knowledge base.

The design is intentionally thin:

- the extension captures a URL plus optional title and target folder
- it sends that payload to the companion API at `POST /companion/v1/knowledge/import`
- the PA host does the actual vault write
- for URL shares, the host fetches the page and stores readable extracted content in the note body when it can

That keeps clipping logic on the host side instead of trying to duplicate readable-content extraction inside each browser.

## Why an extension instead of a system hook

For Chrome + Firefox, a WebExtension is the cleanest common surface.

It gives PA the things that matter for URL capture:

- a toolbar popup for saving the current tab
- page and link right-click context menus
- an optional keyboard shortcut
- one mostly shared implementation across Chromium and Firefox

System-level macOS flows are worse here because they are inconsistent across browsers and awkward for right-clicking links.

## Pairing model

The extension talks to the daemon-backed companion API, not the internal web UI routes.

Setup is:

1. open **Settings → Companion Access** in Personal Agent
2. generate a setup URL or pairing code
3. open the extension **Options** page
4. paste the setup URL, or enter the companion host base URL plus pairing code
5. optionally set a default vault folder such as `Inbox`

After pairing, the extension stores a bearer token in extension-local storage and uses it for `knowledge/import` calls.

## Current behavior

The extension currently supports URL capture only.

Available entry points:

- popup save for the current tab
- keyboard shortcut for the current tab
- page context menu item
- link context menu item

Each capture sends:

- `kind: "url"`
- the target URL
- an optional title
- an optional `directoryId`
- a source-app label such as `Personal Agent Chrome Extension`

The host import flow writes the final markdown note into the vault and returns the saved note path.

## Release and install model

Browser extension bundles ship as supplemental assets in `patleeman/personal-agent-releases`.

Current release assets are manual-install bundles:

- Chrome / Chromium: unpacked extension zip for `chrome://extensions`
- Firefox: unpacked extension zip for temporary install from `about:debugging`

The Firefox bundle is not AMO-signed yet, so it is not the permanent consumer-style install path.

## Code layout

The extension lives under:

```text
apps/browser-extension/
```

Important files:

- `scripts/build.mjs` — builds browser-specific bundles and release zips
- `src/background.js` — context-menu and shortcut handling
- `src/popup.*` — quick current-tab capture UI
- `src/options.*` — pairing and default-folder setup UI
- `src/shared.js` — companion URL normalization, pairing, storage, and import helpers

## Related docs

- [Daemon and Background Automation](./daemon.md)
- [Release cycle](./release-cycle.md)
- [iOS host-connected app design](./ios-host-app-plan.md)
- [Repo layout](./repo-layout.md)
