# personal-agent repo instructions

personal-agent is a personal AI agent runtime.

## System prompt constraints

**Never modify the system prompt via extension `before_agent_start` handlers.**
Returning `{ systemPrompt }` from that event is structurally blocked by a guard
in `profileState.ts`. To influence the system prompt, write to the file-based
layers: `defaults/agent/AGENTS.md` (repo defaults), the vault root `AGENTS.md`,
or a CWD `AGENTS.md`. See `docs/knowledge-system.md` for the full assembly
pipeline.

## Development

- Prefer correct full implementations over backwards-compatibility layers. I don't want to implement the fastest smallest improvement most of the time.
- Build all new product features as extensions by default. First ask: “could this be an extension?” The answer should be yes unless the work is core runtime, security, persistence, extension-host infrastructure, or app-shell plumbing.
- If the extensions API is not powerful enough for the feature, improve the extensions API with general-purpose capabilities instead of hardcoding a one-off app feature. Every new extension should be able to reuse the new capability.
- For web UI work, prefer server-pushed updates (SSE + POST) over client polling when the backend can publish change events.
- I often work on multiple features at the same time. Check other active runs and coordinate your work if you start seeing unintended changes to files you're editing.
- If the worktree already has unrelated changes, I always want targeted commits that stage only the files for the task at hand.

## Always validate your work!

- After you complete a feature, make sure you actually inspect your work.
- If you're working in the web-ui, spin up the UI on a separate port and use the repo wrapper `npm run ab:run -- --session <name> --command "ab ..."` instead of raw `agent-browser` so sessions always close cleanly. See `docs/browser.md` and the agent-browser skill for more information.
- When launching the test desktop app for QA, pass `--no-quit-confirmation` (or `--skip-quit-confirmation`) so cleanup is non-interactive, e.g. `npm run desktop:dev -- --remote-debugging-port=9222 --no-quit-confirmation`.
- After QA, close the test app and browser session before reporting done: quit `Personal Agent Testing.app` and run `npm run ab:cleanup -- --session <name>` if you used the wrapper.
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

The docs folder is for agents to use and understand how personal-assistant works. Make sure to update it and keep it updated anytime you make a commit.

## Checkpoint as the final step

Before declaring a task complete, /skill:checkpoint your work. This is the last thing you do — after all validations pass, before you summarize what was done. In this repo we commit and push directly to main, no need to create branches.

- I explicitly want targeted checkpoints for the code you modified.
- If a file has unrelated work mixed in, stage only your hunks. If you cannot do that safely, stop and tell me instead of sweeping unrelated changes into the commit.

## Code quality checks

This repo has automated checks to keep the codebase clean.

### Pre-commit hook (`.githooks/pre-commit`)

Runs on every commit — gitleaks, typecheck, prettier, and eslint on staged files.
Bypass with `git commit --no-verify` if needed.

### npm scripts

```bash
npm run check    # tsc --noEmit → eslint → prettier --check → knip (dead code)
npm run fix      # prettier --write + eslint --fix
```

- **`check:types`** — `tsc --noEmit` (0.3s). Catches type errors and unused imports.
- **`lint`** — `eslint` with `simple-import-sort` for import ordering.
- **`fmt`** — `prettier --check`. Config: single quotes, trailing commas, 140 width.
- **`check:dead`** — `knip`. Catches unused exports, files, and dependencies. Config in `knip.json`.

### Coverage

```bash
npm run check:coverage  # ~30s, shows statement/branch/function/line coverage
```

Not part of `npm run check` (too slow). Run periodically to spot uncovered areas. Warns on issues, doesn't block.

### What to do before committing

Run `npm run fix` to auto-format and fix import ordering, then `npm run check` to verify everything passes. If the pre-commit hook blocks on pre-existing lint issues (there are ~80 baseline errors in untouched files), that's fine — just ensure your new code doesn't add more.

## Secret scanning

This repo has a gitleaks pre-commit hook that scans staged changes for secrets before every commit.

- The hook lives at `.githooks/pre-commit` (tracked in the repo).
- Config is at `.gitleaks.toml`.
- The hook activates automatically via `npm postinstall` which runs `git config core.hooksPath .githooks`.
- If gitleaks finds something, the commit aborts. Review the finding and either fix it or bypass with `git commit --no-verify` if it's a false positive.
- Install gitleaks locally with `brew install gitleaks` if it's not already present (the hook skips gracefully if missing).
