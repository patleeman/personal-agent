# personal-agent repo instructions

personal-agent is a personal AI agent runtime.

## Development

- Prefer correct full implementations over backwards-compatibility layers. I don't want to implement the fastest smallest improvement most of the time.
- For web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.
- I often work on multiple features at the same time. Check other active runs and coordinate your work if you start seeing unintended changes to files you're editing.
- If the worktree already has unrelated changes, I always want targeted commits that stage only the files for the task at hand.

## Always validate your work!

- After you complete a feature, make sure you actually inspect your work. 
- If you're working in the web-ui, spin up the UI on a separate port and use the repo wrapper `npm run ab:run -- --session <name> --command "ab ..."` instead of raw `agent-browser` so sessions always close cleanly. See `docs/agent-browser.md` and the agent-browser skill for more information.
- Make sure the work is complete, to spec, works without bugs, and looks good.

## UI Design Bans

- For personal-agent web UI work, avoid nested bordered containers/cards (`boxes inside boxes`) unless they are truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy instead.
- Ensure consistency across pages, don't design in isolation!
- If you modify anything in the web ui, you MUST perform a visual check before signing off on the work! Make sure there is no jank and the output looks good.

## Release flow

If the goal is to publish a downloadable installable macOS app on GitHub Releases, use the local signed release flow.

1. From the repo root, run `npm run release:desktop:patch`, `npm run release:desktop:minor`, or `npm run release:desktop:major`.
2. That flow bumps the version, uses the local `Developer ID Application` certificate from Keychain, notarizes with local Apple credentials, pushes the commit and tag, and creates or updates the matching GitHub Release in the same repo.
3. Before pushing/uploading, the publish script requires a smoke test of the built `.app` from `dist/release/mac-arm64/Personal Agent.app`; only continue once startup plus one conversation and Knowledge-page route pass. For non-interactive reruns of an already-tested build, set `PERSONAL_AGENT_RELEASE_SMOKE_TESTED=1`.
4. `npm run release:publish` is the standalone publish step if the version bump already happened and you just need to rebuild/retry the signed release.
5. The publish script auto-loads Apple credentials from `PERSONAL_AGENT_RELEASE_ENV` when set, otherwise falls back to `.env` in the repo root and then `~/.config/personal-agent/release-env`. It maps `APPLE_PASSWORD` to `APPLE_APP_SPECIFIC_PASSWORD` for notarization and can target another public release repo with `PERSONAL_AGENT_RELEASE_REPO`.
6. Release assets must include the Electron updater metadata (`latest-mac.yml`) plus the signed macOS `.zip` / `.zip.blockmap`, and optionally the `.dmg` / `.dmg.blockmap`.

Important: pushing commits or tags to `master` does not create a GitHub release by itself anymore. Release artifacts are built locally with the local `Developer ID Application` certificate from Keychain, then uploaded to the same repo's GitHub Releases for in-app auto-updates.

See `docs/release-cycle.md` for the fuller release notes.

## Docs are for agents

The docs folder is for agents to use and understand how personal-assistant works. Make sure to update it.

## Checkpoint when complete

Once you're done with your task, remember to /skill:checkpoint your work. In this repo we commit and push directly to main, no need to create branches.
- I explicitly want targeted checkpoints for the code you modified.
- If a file has unrelated work mixed in, stage only your hunks. If you cannot do that safely, stop and tell me instead of sweeping unrelated changes into the commit.

## Secret scanning

This repo has a gitleaks pre-commit hook that scans staged changes for secrets before every commit.

- The hook lives at `.githooks/pre-commit` (tracked in the repo).
- Config is at `.gitleaks.toml`.
- The hook activates automatically via `npm postinstall` which runs `git config core.hooksPath .githooks`.
- If gitleaks finds something, the commit aborts. Review the finding and either fix it or bypass with `git commit --no-verify` if it's a false positive.
- Install gitleaks locally with `brew install gitleaks` if it's not already present (the hook skips gracefully if missing).
