# personal-agent repo instructions

personal-agent is Patrick's personal AI agent runtime. Keep core small and build user-facing features as extensions by default.

## Always-on rules

- Prefer correct, complete implementations over compatibility shims or narrow safe cuts.
- If a feature needs a shared boundary — process execution, security policy, persistence, routing, extension APIs — implement the boundary and wire first-class call sites through it.
- Build product/workflow UX in extensions unless the work is core runtime, security, persistence, extension-host infrastructure, app-shell plumbing, routing, install/update plumbing, or shared UI primitives.
- If the extension API is missing a capability, add the smallest general-purpose API surface to core instead of hardcoding a one-off feature.
- For web UI, prefer server-pushed updates over polling when the backend can publish events.
- Multiple agents may be working here. Do targeted changes and targeted checkpoints; stop if unrelated edits conflict with your work.

## Prompt and knowledge rules

- Never modify the system prompt from extension `before_agent_start` handlers. Use file-based instruction layers instead: repo defaults, vault root `AGENTS.md`, or cwd `AGENTS.md`.
- Docs are for agents. Update docs whenever behavior or workflow changes.
- Before changing feature behavior, read the owning extension README plus relevant docs from `docs/index.md`.

## Validation and checkpoints

- Validate the actual work before calling it done. Use the narrowest meaningful check first, then broader checks when risk warrants it.
- If you modify web UI, perform a visual check. Use the repo wrapper for agent-browser sessions and clean up only processes you started.
- Before final summary, use the `checkpoint` skill/tool for a targeted commit. Do not stage unrelated files.

## UI design bans

- Avoid nested bordered containers/cards unless truly unavoidable.
- Avoid decorative pills/chips as a default treatment; use spacing, typography, and alignment for hierarchy.
- Keep pages visually consistent; do not design in isolation.

## Workflow references

- Development, validation, UI QA, gitleaks, and checkpoint details: `docs/development.md`.
- Release process, current version, signed build flow, and release gotchas: `docs/release-cycle.md`.
- Extension authoring/API rules: `docs/extensions.md` and `packages/extensions/README.md`.
- Browser feature docs: `extensions/system-browser/README.md`; Workbench Browser skill handles built-in browser context.
