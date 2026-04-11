# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The inbox/notifications page and nav were already removed. This slice deletes the now-dead renderer/public activity-and-alert surface behind that UI removal: no `api.activity*` or `api.alert*` methods remain, no dedicated desktop bridge/IPC/local-host methods remain for those routes, and the public `/api/activity*`, `/api/alerts*`, and `/api/inbox/clear` route layer is gone. The lower-level inbox/alert capability code is still intact for internal attention/tooling callers.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of dead product surfaces after the desktop release

## Latest validation
- `npx vitest run packages/web/src/api.desktop.test.ts packages/desktop/src/hosts/local-host-controller.test.ts packages/desktop/src/app-protocol.test.ts packages/web/server/routes/webUi.test.ts packages/web/server/routes/registerAll.smoke.test.ts`
- `npx eslint packages/web/src/api.ts packages/web/src/api.desktop.test.ts packages/web/src/desktopBridge.ts packages/web/server/routes/registerAll.ts packages/web/server/routes/webUi.ts packages/web/server/routes/webUi.test.ts packages/web/server/app/localApi.ts packages/desktop/src/preload.ts packages/desktop/src/preload.cts packages/desktop/src/ipc.ts packages/desktop/src/hosts/types.ts packages/desktop/src/hosts/local-host-controller.ts packages/desktop/src/hosts/local-host-controller.test.ts packages/desktop/src/local-api-module.ts packages/desktop/src/app-protocol.test.ts`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: app booted, `window.personalAgentDesktop.readActivity === 'undefined'`, `readAlerts === 'undefined'`, `/inbox` still redirected to `/conversations/new`, and the sidebar still showed the expected main nav

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Inspect the next thin cleanup lever for the tool-first architecture: either remove now-unused renderer app-state/event handling for activity/alerts, or switch to the next clearly dead public notification/admin surface if one is still left.
