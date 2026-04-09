# Release cycle

`personal-agent` now publishes macOS releases from Patrick's local machine instead of having GitHub Actions build the shipped artifacts.

The release path is intentionally simple:

1. bump the repo version with `npm version` at the repo root
2. let the version hook sync every `packages/*/package.json` version and refresh `package-lock.json`
3. build and notarize the macOS desktop app locally with Patrick's Keychain signing identity
4. push the commit and tag to GitHub and create or update the GitHub release with the generated `.dmg` and `.zip`

## Local commands

Fast path from the repo root:

- `npm run release:desktop:patch`
- `npm run release:desktop:minor`
- `npm run release:desktop:major`

Those commands:

- create the version bump commit and `v<version>` tag through `npm version`
- build signed desktop artifacts locally
- push the commit and tag
- create or update the matching GitHub release

If the version bump already happened and you just need to retry the signed publish step, run:

```bash
npm run release:publish
```

## Local signing and notarization inputs

`npm run release:publish` expects a local `Developer ID Application` certificate in Keychain.

It also needs Apple notarization credentials. The script will use whichever is available first:

- environment variables already exported in the shell
- `~/workingdir/familiar/.env`
- the file pointed to by `PERSONAL_AGENT_RELEASE_ENV`

When loading from env, the script accepts standard `APPLE_ID`, `APPLE_TEAM_ID`, and `APPLE_APP_SPECIFIC_PASSWORD`. It also maps `APPLE_PASSWORD` to `APPLE_APP_SPECIFIC_PASSWORD` for compatibility with Patrick's existing local `.env`.

If multiple `Developer ID Application` certificates are present, set `CSC_NAME` before running the publish step. Use the certificate name without the `Developer ID Application:` prefix.

## What gets built

`npm run desktop:dist` does the release build locally. It:

- builds the desktop package and its dependencies
- packages the Electron desktop app with `electron-builder`
- signs it with the local `Developer ID Application` certificate
- notarizes the packaged app and staples it
- notarizes the shipped `.dmg` and staples it so the downloadable installer is accepted by Gatekeeper
- writes release artifacts to `dist/release/`

GitHub Actions no longer publishes shipped release artifacts automatically. `.github/workflows/release.yml` is now only a manual smoke-build workflow for unsigned CI packaging checks.

## Desktop update checks

The packaged desktop app checks GitHub Releases for newer versions:

- it performs an automatic check shortly after launch and periodically while the app stays open
- the tray menu also exposes `Check for Updates…` for an on-demand check
- when a newer release exists, it opens the signed installer download or release page in the browser for manual install
- unpackaged development runs keep update checks disabled

## Packaged desktop runtime layout

The packaged app now carries the runtime data the desktop shell needs:

- built `@personal-agent/daemon` and `@personal-agent/web` packages inside the packaged app
- repo-level `defaults/`, `extensions/`, `internal-skills/`, and `prompt-catalog/` directories as extra resources

When packaged, the desktop shell launches the bundled daemon and web server with the Electron binary in `ELECTRON_RUN_AS_NODE` mode instead of relying on a separately installed `node` executable.

## Current scope

This release flow currently targets macOS arm64 only.

Shipped binaries are published through GitHub releases from Patrick's local signed build path.

## Related docs

- [Electron desktop app plan](./electron-desktop-app-plan.md)
- [Electron desktop app implementation spec](./electron-desktop-app-spec.md)
