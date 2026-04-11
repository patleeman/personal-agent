# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The public inbox page and public activity/alert API layer are gone. This slice removes the last renderer-side app-state wiring for those notification surfaces: `AppDataContext` no longer carries activity/alerts, `App.tsx` no longer stores or handles those snapshots, the initial app snapshot bootstrap no longer requests activity/alert snapshots, and renderer transport now drops activity/alert snapshot events instead of mapping them into desktop app state. Internal conversation attention and backend activity/alert capability code remain intact.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead renderer state after the inbox surface removal

## Latest validation
- `npx vitest run packages/web/src/components/Sidebar.test.tsx packages/web/src/components/ContextRail.test.tsx packages/web/src/pages/TasksPage.test.tsx packages/web/src/appEventTransport.test.ts packages/web/src/desktopAppEvents.test.ts packages/web/server/routes/system.test.ts packages/web/server/routes/system.routes.test.ts`
- `npx eslint packages/web/src/App.tsx packages/web/src/contexts.ts packages/web/src/appEventTransport.ts packages/web/src/appEventTransport.test.ts packages/web/src/desktopAppEvents.test.ts packages/web/src/components/Sidebar.test.tsx packages/web/src/components/ContextRail.test.tsx packages/web/src/pages/TasksPage.test.tsx packages/web/src/types.ts packages/web/server/app/localApi.ts packages/web/server/routes/system.ts packages/web/server/routes/system.test.ts packages/web/server/routes/system.routes.test.ts`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted, main nav rendered, and `personal-agent://app/inbox` still redirected to `/conversations/new`

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Inspect whether the remaining server-side app-events snapshot work for activity/alerts is still worth trimming, or switch to the next thin tool-first cleanup surface around system/settings/runtime copy and dead notification-era labels.
