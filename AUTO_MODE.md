# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice trims another inbox-era name from the remaining activity-attention internals. The shared cleanup helper is now `clearActivityAttentionForCurrentProfile`, the capability layer calls that activity-focused name, the read-state save comment no longer talks about inbox mutations, and the matching tests/mocks were updated. Behavior is unchanged; the remaining internals just read more like the current product direction.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale inbox naming in shared activity-attention helpers

## Latest validation
- `npx vitest run packages/web/server/automation/inboxService.test.ts packages/web/server/automation/inboxService.mocked.test.ts packages/web/server/automation/inboxCapability.test.ts`
- `npx eslint packages/web/server/automation/inboxService.ts packages/web/server/automation/inboxService.test.ts packages/web/server/automation/inboxService.mocked.test.ts packages/web/server/automation/inboxCapability.ts packages/web/server/automation/inboxCapability.test.ts`
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt and `origin/master` kept moving during the loop
- wakeup policy: none needed for this slice

## Next step
Keep trimming the remaining inbox-era names in the internal attention/activity modules, unless the next clearer leverage is deleting or renaming one more dead helper parked in `packages/web/server/index.ts`.
