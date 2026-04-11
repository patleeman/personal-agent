# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice cleans up one stale deferred-resume test fixture that was still modeling the old inbox-style delivery shape. `conversationService.test.ts` now uses the current deferred-resume kind and delivery fields (`kind: 'continue'` plus alert-level/ack/auto-resume delivery metadata), which matches the real runtime contract after the inbox removal work.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale deferred-resume fixture data

## Latest validation
- `npx vitest run packages/web/server/conversations/conversationService.test.ts`
- `npx eslint packages/web/server/conversations/conversationService.test.ts`
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree briefly picked up unrelated build-state movement while `origin/master` advanced
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale inbox/notification-era fixtures and wording where they no longer match the real post-inbox runtime contract, unless a better leverage slice appears.
