# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice trims the remaining inbox-era helper names parked in `packages/web/server/index.ts`. The retention loop and related helper names now use activity-attention wording instead of inbox wording, and the last index-local conversation-context helper now matches the current activity naming. Behavior is unchanged; this is a surgical internal-name cleanup in a file with broader historical lint debt.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale inbox naming in the legacy server bootstrap file

## Latest validation
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt and `origin/master` kept moving during the loop
- wakeup policy: none needed for this slice

## Next step
Keep trimming remaining inbox-era internal names, especially in the legacy server bootstrap and any shared attention helpers that still describe activity cleanup as inbox behavior.
