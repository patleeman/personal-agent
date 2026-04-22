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

1. bump the version with `npm version`
2. sync workspace package versions and refresh `package-lock.json`
3. build signed desktop artifacts locally
4. notarize the artifacts
5. push the commit and tag
6. create or update the matching GitHub release in `patleeman/personal-agent-releases`

If the version bump already happened and you only need to retry publish:

```bash
npm run release:publish
```

## Signing and notarization inputs

`npm run release:publish` expects:

- a local `Developer ID Application` certificate in Keychain
- Apple notarization credentials

Credential lookup order:

1. already-exported shell environment
2. file pointed to by `PERSONAL_AGENT_RELEASE_ENV`
3. `.env` in the repo root
4. `~/workingdir/familiar/.env`

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

Artifacts are uploaded to the public release-only repo, not to the private source repo.

## Current scope

- signed macOS desktop build
- local notarization
- GitHub release publish to `patleeman/personal-agent-releases`

## Practical rule

If the goal is a downloadable macOS app on GitHub Releases, use the local signed release flow and then verify the uploaded assets.

## Related docs

- repo `AGENTS.md`
- [Repo Layout](./repo-layout.md)
- [Troubleshooting](./troubleshooting.md)
