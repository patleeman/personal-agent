# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The dead notification page, public API surface, renderer state, and snapshot transport are already gone. This slice removes one more stale notification-era status field: app status no longer reports `activityCount`, and the matching desktop/local status plumbing and frontend type expectations are simplified to only the status data still used.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead product metadata after the notification surface removal

## Latest validation
- `npx vitest run packages/web/src/api.desktop.test.ts packages/desktop/src/hosts/local-host-controller.test.ts packages/web/server/routes/system.routes.test.ts packages/web/src/pages/SettingsPage.test.tsx`
- `npx eslint packages/web/src/types.ts packages/web/server/routes/system.ts packages/web/server/app/localApi.ts packages/web/src/api.desktop.test.ts packages/desktop/src/hosts/local-host-controller.test.ts packages/web/server/routes/system.routes.test.ts packages/web/src/pages/SettingsPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted to `/conversations/new` and the main nav still rendered

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming thin dead notification-era or status/admin leftovers, unless the next clear leverage is to simplify tool-first product language in the remaining settings/system surfaces.
