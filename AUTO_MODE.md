# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
After upstream stripped more inbox internals, this slice cleaned up the remaining stale inbox-era documentation and one backend error string that were still describing the app as if inbox were a live product surface. Workspace/web-server/electron desktop docs now talk about reminders, async attention, and internal attention helpers instead of inbox-first concepts, and the local API capability error now refers to activity context instead of inbox context.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale inbox terminology after the latest upstream cleanup

## Latest validation
- `npx eslint packages/web/server/app/localApi.ts`
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt and `origin/master` moved during the loop
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale inbox/notification references from docs and internal names, unless the next clearer leverage is a larger end-to-end rename of the remaining activity/attention capability surfaces.
