# Agent Browser in this repo

`agent-browser` is a CLI/dev validation tool. It is separate from the Electron desktop app's built-in Workbench Browser tab.

Use the built-in Workbench Browser as a communication surface: Patrick can show a page, attach browser comments, and let the agent inspect or act on that same visible conversation-scoped page. Use `agent-browser` when developing, validating, smoke-testing, or automating the app from an agent-run shell. Do not treat `agent-browser` sessions as the same browser session shown in the Workbench Browser unless a future bridge explicitly unifies them.

Use `agent-browser` through the repo wrapper instead of calling it raw.

Why: raw `agent-browser --session ...` launches a Playwright-backed daemon per session under `~/.agent-browser`. If the session never gets an explicit `close`, the daemon and its `chrome-headless-shell` children can stick around and burn CPU later.

## Preferred wrapper

From the repo root:

```bash
npm run ab:run -- --session kb-check --command "ab open personal-agent://app/knowledge && ab wait 1500 && ab snapshot -i"
```

Inside the `--command` string, use `ab ...` instead of `agent-browser ...`.

The wrapper:

- binds every call to one named session
- defines `ab()` as a short helper for `agent-browser --session <name>`
- always runs `agent-browser --session <name> close` on exit, even if the command fails

## When you really need a persistent session

Only keep a session open if you need browser state across multiple separate commands or turns:

```bash
npm run ab:run -- --session my-long-check --keep-open --command "ab open personal-agent://app/"
agent-browser --session my-long-check snapshot -i
agent-browser --session my-long-check close
```

If you use `--keep-open`, you own the cleanup. Always end with `agent-browser --session <name> close`.

## Cleaning up stale sessions

Preview what would be removed:

```bash
npm run ab:cleanup -- --dry-run
```

Clean up stale sessions older than 6 hours:

```bash
npm run ab:cleanup -- --older-than-hours 6
```

The cleanup command removes dead sessions immediately and closes old live sessions by name.

## Repo rule

For desktop app validation in `personal-agent`, prefer:

```bash
npm run ab:run -- --session <short-name> --command "ab ..."
```

Do not leave raw `agent-browser` sessions open unless you intentionally need a persistent browser and you close it yourself before finishing.
