# Release Cycle

Desktop releases are built, signed, notarized, and published locally.

Do not rely on pushing a tag to `main` to produce a shipped desktop release automatically.

## Main commands

From the repo root:

```bash
npm run release:desktop:patch
npm run release:desktop:minor
npm run release:desktop:major
```

Those commands:

1. bump the app version with `npm version`
2. refresh `@mariozechner/pi-coding-agent` to the latest published npm version
3. sync workspace package versions and refresh `package-lock.json`
4. build signed desktop artifacts locally
5. notarize the artifacts
6. require a smoke test of the built `.app` binary
7. push the commit and tag
8. create or update the matching GitHub release in the source repo's GitHub Releases

Pi is now updated automatically by the `npm version` step used by the desktop release commands. If Pi is already current, the step is a no-op.

If the version bump already happened and you only need to retry publish:

```bash
npm run release:publish
```

## Built binary smoke test

`npm run release:publish` runs an automated smoke test after signing/notarization and before pushing the tag or uploading release assets. The smoke test launches the built `.app` with an isolated temporary `PERSONAL_AGENT_STATE_ROOT`, daemon socket, and companion port so an already-running user daemon cannot block the release check.

The automated check verifies:

1. the built app process starts
2. the Electron renderer exposes a page over CDP
3. the initial app route renders non-empty UI without startup-error text
4. the Knowledge route renders
5. the conversation route renders

If you need to run the same check manually:

```bash
node scripts/smoke-desktop-release.mjs "<release-snapshot>/dist/release/mac-arm64/Personal Agent.app"
```

If the automated check is unavailable and you need to do the older manual gate, set `PERSONAL_AGENT_RELEASE_SKIP_AUTOMATED_SMOKE=1`. The script will stop and ask you to test the built app from the release output, usually:

```bash
open -n "<release-snapshot>/dist/release/mac-arm64/Personal Agent.app"
```

Minimum smoke test:

1. launch the built app successfully
2. verify the shell loads without startup/beachball regressions
3. open one conversation route
4. open the Knowledge page and switch at least one file

Only continue the publish prompt after the built binary passes. For non-interactive reruns where the exact built binary was already tested, set:

```bash
PERSONAL_AGENT_RELEASE_SMOKE_TESTED=1 npm run release:publish
```

## Signing and notarization inputs

`npm run release:publish` expects:

- a local `Developer ID Application` certificate in Keychain
- Apple notarization credentials

Credential lookup order:

1. already-exported shell environment
2. file pointed to by `PERSONAL_AGENT_RELEASE_ENV`
3. `.env` in the repo root
4. `~/.config/personal-agent/release-env`

The publish script accepts:

- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_PASSWORD` as a compatibility alias for `APPLE_APP_SPECIFIC_PASSWORD`

If multiple signing identities exist, set `CSC_NAME`.

## What gets published

Expected public release assets:

- `latest-mac.yml`
- signed macOS `.zip`
- `.zip.blockmap`
- optionally `.dmg` and `.dmg.blockmap`

Artifacts are uploaded to the source repo's GitHub Releases so the auto-updater can fetch them from the same repo.

## Current scope

- signed macOS desktop build
- local notarization
- GitHub release publish in the source repo's GitHub Releases

## Practical rule

If the goal is a downloadable macOS app on GitHub Releases, use the local signed release flow, smoke test the built binary before publishing, and then verify the uploaded assets.

## Related docs

- repo `AGENTS.md`
- [Repo Layout](./repo-layout.md)
- [Troubleshooting](./troubleshooting.md)
