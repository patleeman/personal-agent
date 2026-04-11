# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The public notification product surface is gone, and this slice tightens the remaining renderer event contract around that reality. Frontend `AppEventTopic` no longer models `activity` or `alerts`, the frontend event-version state no longer tracks them, and invalidation handling now ignores unknown backend topics instead of assuming every topic belongs to the renderer’s tracked set.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead notification-era renderer event bookkeeping

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx packages/web/src/components/ConversationArtifactModal.test.tsx`
- `npx eslint packages/web/src/types.ts packages/web/src/contexts.ts packages/web/src/App.tsx packages/web/src/components/ConversationArtifactModal.test.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted to `/conversations/new` and the main nav still rendered

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming thin dead notification-era or admin/status leftovers, unless the next clearer leverage is copy/concept cleanup toward tools + conversations as the only product surfaces.
