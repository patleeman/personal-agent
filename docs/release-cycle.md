# Release cycle

`personal-agent` now has a tag-driven desktop release flow.

The release path is intentionally simple:

1. bump the repo version with `npm version` at the repo root
2. let the version hook sync every `packages/*/package.json` version and refresh `package-lock.json`
3. push the commit and tag to GitHub
4. GitHub Actions builds the macOS arm64 desktop app and creates a GitHub release with the generated `.dmg` and `.zip`

## Local commands

Use one of these from the repo root:

- `npm run release:patch`
- `npm run release:minor`
- `npm run release:major`

That creates a commit and a `v<version>` tag through `npm version`.

Then publish it with:

```bash
git push --follow-tags
```

## What gets built

`npm run desktop:dist` does the release build locally. It:

- builds the desktop package and its dependencies
- packages the Electron desktop app with `electron-builder`
- writes release artifacts to `dist/release/`

The GitHub workflow at `.github/workflows/release.yml` runs the same build on `macos-14` and attaches the resulting artifacts to the matching GitHub release.

## Desktop update checks

The packaged desktop app now checks GitHub Releases for newer macOS builds:

- it performs an automatic check shortly after launch and periodically while the app stays open
- the tray menu also exposes `Check for Updates…` for an on-demand check
- when a newer release exists, the app opens the matching GitHub release asset (`.dmg` when available) in the browser for download

Current scope: this is a GitHub-release download flow, not a fully in-place signed macOS auto-installer yet. Proper native auto-install on macOS still requires signing and notarization.

## Packaged desktop runtime layout

The packaged app now carries the runtime data the desktop shell needs:

- built `@personal-agent/daemon` and `@personal-agent/web` packages inside the packaged app
- repo-level `defaults/`, `extensions/`, `internal-skills/`, and `prompt-catalog/` directories as extra resources

When packaged, the desktop shell launches the bundled daemon and web server with the Electron binary in `ELECTRON_RUN_AS_NODE` mode instead of relying on a separately installed `node` executable.

## Current scope

This release flow currently targets macOS arm64 only.

It now uses ad-hoc signing so downloaded builds do not hit the unbypassable “app is damaged” failure on Apple Silicon. It still does not perform Apple Developer ID signing or notarization yet, so macOS will continue to show the normal unverified-app warning for downloaded releases until that is added.
