# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice trims another layer of stale inbox-era internal naming around the remaining activity attention capability. The web server now uses `ActivityCapabilityContext`, `ActivityCapabilityInputError`, `clearActivityAttentionCapability`, `buildActivityConversationContext`, and matching local-API activity-context names instead of inbox-prefixed internal symbols. Behavior stayed the same; only the remaining internal naming was tightened.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale inbox naming in the remaining activity attention capability

## Latest validation
- `npx vitest run packages/web/server/automation/inboxCapability.test.ts`
- `npx eslint packages/web/server/automation/inboxCapability.ts packages/web/server/automation/inboxCapability.test.ts packages/web/server/app/localApi.ts`
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt and `origin/master` kept moving during the loop
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale inbox/notification naming from the remaining internal activity/attention modules, unless the next clearer leverage is a larger rename or deletion of one more dead legacy helper in `packages/web/server/index.ts`.
