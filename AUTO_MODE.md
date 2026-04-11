# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice removed the remaining dead notification-era app-event topics from the shared backend event contract. `activity` and `alerts` are no longer modeled as backend app-event topics or profile-switch invalidation topics, and the remaining inbox/alert mutations now invalidate the still-live snapshots that actually matter (`sessions` and, where relevant, `runs`). The file watchers for activity and alert state still feed the `sessions` topic, so conversation attention behavior stays intact without carrying dead top-level notification topics.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead notification-era backend invalidation/watch concepts

## Latest validation
- `npx vitest run packages/web/server/automation/inboxCapability.test.ts packages/web/server/automation/alertCapability.test.ts packages/web/server/app/profileState.test.ts packages/web/server/routes/system.test.ts packages/web/server/routes/system.routes.test.ts packages/web/server/shared/appEvents.test.ts packages/web/server/shared/appEvents.mocked.test.ts packages/web/server/shared/snapshotEventStreaming.test.ts`
- `npx eslint packages/web/server/shared/appEvents.ts packages/web/server/shared/appEvents.test.ts packages/web/server/shared/appEvents.mocked.test.ts packages/web/server/shared/snapshotEventStreaming.test.ts packages/web/server/app/profileState.ts packages/web/server/app/profileState.test.ts packages/web/server/automation/inboxCapability.ts packages/web/server/automation/inboxCapability.test.ts packages/web/server/automation/alertCapability.ts packages/web/server/automation/alertCapability.test.ts packages/web/server/routes/system.routes.test.ts packages/web/server/extensions/activityAgentExtension.ts`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted to `/conversations/new` with Chat / Automations / Settings visible

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming dead notification/admin-era product concepts, with the next likely leverage in stale docs/copy or another thin backend surface that still mentions inbox/notifications even though the product no longer exposes them.
