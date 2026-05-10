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

## Release Flow

Each release command performs these steps in order:

1. **Version bump** — `npm version` bumps the version following semver
2. **Pi update** — refreshes the direct Pi runtime packages to the latest published version
3. **Dependency sync** — updates workspace package versions and regenerates `package-lock.json`
4. **Build** — builds signed desktop artifacts locally
5. **Notarize** — submits the built `.app` for Apple notarization
6. **Smoke test** — launches the built app in an isolated environment and verifies basic functionality
7. **Git push** — pushes the version commit and tag to the remote
8. **GitHub release** — creates or updates the matching release in the releases repository

## Automated Smoke Test

The release script runs an automated smoke test after signing and notarization, before pushing the tag. It launches the built `.app` with:

- An isolated temporary `PERSONAL_AGENT_STATE_ROOT`
- A dedicated daemon socket and companion port
- No interference from an already-running user daemon

The check verifies:

1. The app process starts successfully
2. The Electron renderer exposes a page over CDP
3. The initial route renders non-empty UI without startup errors
4. Agent-readable packaged resources exist (`docs/index.md`, system extension READMEs, and extension skill files)
5. The Knowledge route renders
6. A conversation route renders

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

This runs the smoke test, push, and GitHub release creation without repeating the version bump and build steps.

## Prerequisites

- **Apple Developer account** — for signing and notarization
- **GitHub access** — to push tags and create releases
- **Notarization credentials** — configured in the build environment
- **GitHub release repository** — configured for artifact uploads
