# personal-agent repo instructions

This is personal software, built for Patrick by Patrick.

## Development

- Prefer correct full implementations over backwards-compatibility layers. I don't want to implement the fastest smallest improvement most of the time.
- For web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.
- I often work on multiple features at the same time. Check other active runs and coordinate your work if you start seeing unintended changes to files you're editing.
- If the worktree already has unrelated changes, I always want targeted commits that stage only the files for the task at hand.

## Always validate your work!

- After you complete a feature, make sure you actually inspect your work. 
- If you're working in the web-ui, ppin up the UI on a separate port and use the agent-browser CLI tool to inspect and interact with your changes. Read the agent-browser skill for more information.
- Make sure the work is complete, to spec, works without bugs, and looks good.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.
- Ensure consistency across pages, don't design in isolation!
- If you modify anything in the web ui, you MUST perform a visual check before signing off on the work! Make sure there is no jank and the output looks good.

## Release flow

If the goal is to publish a downloadable installable macOS app on GitHub Releases, use the local signed release flow.

1. From the repo root, run `npm run release:desktop:patch`, `npm run release:desktop:minor`, or `npm run release:desktop:major`.
2. That flow bumps the version, uses the local `Developer ID Application` certificate from Keychain, notarizes with local Apple credentials, pushes the commit and tag to the private source repo, and creates or updates the matching release in the public `patleeman/personal-agent-releases` repo.
3. `npm run release:publish` is the standalone publish step if the version bump already happened and you just need to rebuild/retry the signed release.
4. The publish script auto-loads Apple credentials from `PERSONAL_AGENT_RELEASE_ENV` when set, otherwise falls back to `.env` in the repo root and then `~/workingdir/familiar/.env`. It maps `APPLE_PASSWORD` to `APPLE_APP_SPECIFIC_PASSWORD` for notarization and can target another public release repo with `PERSONAL_AGENT_RELEASE_REPO`.
5. Release assets must include the Electron updater metadata (`latest-mac.yml`) plus the signed macOS `.zip` / `.zip.blockmap`, and optionally the `.dmg` / `.dmg.blockmap`.

Important: pushing commits or tags to `master` does not create a GitHub release by itself anymore. Release artifacts are built locally so they can use Patrick's Keychain signing identity, then uploaded to the public release-only repo for in-app auto-updates.

See `docs/release-cycle.md` for the fuller release notes.

## Docs are for agents

The docs folder is for agents to use and understand how personal-assistant works. Make sure to update it.

## Checkpoint when complete

Once you're done with your task, remember to /skill:checkpoint your work. In this repo we commit and push directly to main, no need to create branches.