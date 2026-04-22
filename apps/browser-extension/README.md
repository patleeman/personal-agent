# Personal Agent browser extension

This app holds a minimal Chrome/Firefox WebExtension that saves page and link URLs into a Personal Agent knowledge base through the companion API.

## Local build

From the repo root:

```bash
npm run extension:build
npm run extension:dist
```

- `extension:build` writes unpacked browser-specific bundles to `apps/browser-extension/dist/`
- `extension:dist` also creates release zip assets under `apps/browser-extension/dist/release/`

## Current scope

- pair the extension with a PA companion host using a setup URL or pairing code
- save the current page from the popup
- save the current page with a keyboard shortcut
- save a page or link URL from the right-click context menu
- rely on the host-side `knowledge/import` flow for readable-content extraction and vault note creation
