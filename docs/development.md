# Development Workflow

Use this page for day-to-day repo development, validation, UI QA, and targeted checkpoints.

## Local development

```bash
pnpm install
pnpm run setup:hooks   # optional: enable tracked git hooks
pnpm run build
pnpm run desktop:start
```

The repo intentionally avoids a root `postinstall`. Third-party build scripts are allowlisted in `pnpm-workspace.yaml`; new blocked scripts appear in `pnpm ignored-builds`.

For the desktop dev app:

```bash
cd packages/desktop && pnpm run dev
# or from repo root:
pnpm run desktop:dev
```

## Validation

Pick checks based on the change. Do not run the whole world for a docs-only edit; do run product-specific tests when behavior changes.

```bash
pnpm run fix      # prettier --write + eslint --fix
pnpm run check    # types, lint, format, extension quick check, knip advisory
```

Focused checks:

| Command                           | Use when                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| `pnpm run check:types`            | TypeScript/import/unused-symbol risk                               |
| `pnpm run lint`                   | Lint/import-order risk                                             |
| `pnpm run fmt`                    | Formatting-only verification                                       |
| `pnpm run check:extensions:quick` | Before desktop dev or after extension manifest/backend API changes |
| `pnpm run check:extensions`       | Before release or deep extension runtime verification              |
| `pnpm test`                       | Broad regression pass                                              |
| `pnpm run check:coverage`         | Periodic coverage review; advisory, not blocking                   |

If the pre-commit hook reports pre-existing baseline issues, make sure the task did not add new ones and document the constraint.

## Web UI and desktop QA

If you modify web UI, inspect it visually before signing off. Avoid raw `agent-browser`; use the repo wrapper so sessions close cleanly:

```bash
pnpm run ab:run -- --session <name> --command "ab ..."
pnpm run ab:cleanup -- --session <name>
```

When launching the test desktop app for QA, pass a non-interactive quit flag:

```bash
pnpm run desktop:dev -- --remote-debugging-port=9222 --no-quit-confirmation
```

Desktop runtime channels are intentionally isolated. Stable uses `personal-agent`; RC uses `personal-agent-rc`; dev uses `personal-agent-dev`; test launches use `personal-agent-testing` and random/unset ports. Override only for dev/test with `PERSONAL_AGENT_RUNTIME_CHANNEL`.

Before launching or closing `Personal Agent Testing.app`, check whether another instance already exists. Do not quit, kill, or recycle a process you did not start; connect to it when appropriate or use a separate debug port/session. After QA, close only the app process and browser session you started.

## Checkpoints

Before final summary, use the checkpoint skill/tool. In this repo, checkpoint commits go directly to `main`; no branch is needed.

Rules:

- Stage only files for the current task.
- If unrelated work is mixed into a file and cannot be safely separated, stop and tell Patrick.
- Do not manually `git add`, `git commit`, or `git push`; use the checkpoint tool.

## Secret scanning

The tracked pre-commit hook lives at `.githooks/pre-commit` and runs gitleaks, typecheck, prettier, and eslint on staged files. Enable it with:

```bash
pnpm run setup:hooks
# or:
git config core.hooksPath .githooks
```

Install gitleaks locally with `brew install gitleaks` if needed. If gitleaks flags staged content, fix it unless it is a clear false positive; bypass only deliberately with `git commit --no-verify`.
