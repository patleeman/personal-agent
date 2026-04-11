# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice trims stale dead-notification residue outside the main runtime paths. The remote-host desktop status fallback test no longer expects the deleted `activityCount` field, and the top-level README no longer advertises inbox delivery, notifications, or an outdated `pa inbox list` command as part of the current product surface.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale notification-era docs and test fixtures

## Latest validation
- `npx vitest run packages/web/src/api.desktop.test.ts`
- `npx eslint packages/web/src/api.desktop.test.ts`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale product/docs language around inbox and notifications, or switch back to the next dead backend/admin surface if a clearer code cleanup appears.
