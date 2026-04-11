# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The renderer no longer carries notification state, and this slice trims the matching dead snapshot transport work: `/api/events` and local desktop app-event bootstrap no longer emit activity/alert snapshot payloads, the shared web app transport types no longer model those snapshot events, and the renderer event normalizer no longer mentions them. Internal invalidation topics and backend activity/alert capability code still remain for conversation attention and tool-side callers.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead notification-era event plumbing

## Latest validation
- `npx vitest run packages/web/src/appEventTransport.test.ts packages/web/server/routes/system.test.ts packages/web/server/routes/system.routes.test.ts`
- `npx eslint packages/web/server/routes/system.ts packages/web/server/routes/system.test.ts packages/web/server/routes/system.routes.test.ts packages/web/server/app/localApi.ts packages/web/src/types.ts packages/web/src/appEventTransport.ts packages/web/src/appEventTransport.test.ts`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted and `personal-agent://app/inbox` still redirected to `/conversations/new`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep shaving notification-era leftovers from the app shell and system surfaces, or switch to the next thin dead product concept if a stronger tool-first cleanup lever appears.
