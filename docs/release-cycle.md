# Release Cycle

Desktop releases are built, signed, notarized, and published locally. Pushing a tag to `main` does not automatically produce a release — release is a manual local process.

## Release Commands

```bash
# Patch release (0.5.35 -> 0.5.36)
npm run release:desktop:patch

# Minor release (0.5.35 -> 0.6.0)
npm run release:desktop:minor

# Major release (0.5.35 -> 1.0.0)
npm run release:desktop:major
```

## RC App Identity

Versions with an `-rc` prerelease suffix are packaged as **Personal Agent RC** instead of **Personal Agent**. The RC app uses a separate macOS bundle identifier (`com.personal-agent.desktop.rc`), runtime state root (`personal-agent-rc`), Codex bridge port (`3847`), and artifact prefix (`Personal-Agent-RC-*`), so it can be installed next to the stable app without replacing it.

Stable versions keep the existing app name, bundle identifier, and `Personal-Agent-*` artifact names.

## Release Flow

Each release command performs these steps in order:

1. **Version bump** — `npm version` bumps the version following semver
2. **Pi update** — refreshes the direct Pi runtime packages to the latest published version
3. **Dependency sync** — updates workspace package versions and regenerates `package-lock.json`
4. **Changelog update** — adds a dated `CHANGELOG.md` section for the new version from commits since the previous tag
5. **Build** — builds signed desktop artifacts locally
6. **Notarize** — submits the built `.app` for Apple notarization
7. **Smoke test** — launches the built app in an isolated environment and verifies basic functionality
8. **Git push** — pushes the version commit and tag to the remote
9. **GitHub release** — creates or updates the matching release in the releases repository

## Automated Smoke Test

The release script runs an automated smoke test after signing and notarization, before pushing the tag. It launches the built `.app` with:

- An isolated temporary `PERSONAL_AGENT_STATE_ROOT`
- A dedicated daemon socket and companion port
- No interference from an already-running user daemon

The check verifies:

1. The app process starts successfully
2. The Electron renderer exposes a page over CDP
3. The initial route renders non-empty UI without startup errors
4. Agent-readable packaged resources exist (`docs/index.md`, system extension READMEs, extension skills, and manifest-declared extension bundles)
5. The Knowledge route renders
6. A conversation route renders

`npm run build` also verifies the current daemon output under `packages/desktop/dist/server/daemon/` and rebuilds system extension backends with the same backend API alias used by the runtime loader. If a tool extension fails with missing `@personal-agent/extensions/backend` exports, rerun the full build before cutting the release.

### Manual smoke test

If the automated check is unavailable, set:

```bash
PERSONAL_AGENT_RELEASE_SKIP_AUTOMATED_SMOKE=1
```

The script will stop and ask you to manually test the built `.app` before continuing.

## Retrying Publish

If the version bump and build succeeded but the publish step failed:

```bash
npm run release:publish
```

This runs the smoke test, push, and GitHub release creation without repeating the version bump, changelog update, and build steps.

## Prerequisites

- **Apple Developer account** — for signing and notarization
- **GitHub access** — to push tags and create releases
- **Notarization credentials** — configured in the build environment
- **GitHub release repository** — configured for artifact uploads
