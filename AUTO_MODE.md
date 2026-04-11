# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
This slice trims more stale inbox-era language from the remaining activity tooling and agent docs. Activity follow-up context now talks about "activity" instead of "inbox items", the activity tool description/guidelines now describe durable activity items rather than inbox-managed items, and the decision/conversation docs now frame activity as async attention without implying a live notification-center product surface.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale inbox wording in activity tooling and docs

## Latest validation
- `npx vitest run packages/web/server/automation/inboxCapability.test.ts packages/web/server/extensions/activityAgentExtension.test.ts`
- `npx eslint packages/web/server/automation/inboxCapability.ts packages/web/server/automation/inboxCapability.test.ts packages/web/server/extensions/activityAgentExtension.ts`
- `npm --prefix packages/desktop run build`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale inbox/notification language from docs and remaining internal tool surfaces, or switch to the next dead backend/admin surface if a clearer cleanup appears.
