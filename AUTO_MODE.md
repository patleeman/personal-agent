# Auto Mode State

## Goal
Finish the post-release desktop-first cleanup so the mac app stays the only real product surface and the remaining UI/API concepts keep collapsing toward conversations, runs/tasks, and tools.

## Current status
The recent cleanup shifted from route and event plumbing to product language. This slice removes a couple of stale notification-era UI phrases so the remaining desktop shell reads more like the current product: the empty context rail now points users at conversations, pages, or runs instead of notifications, and profile switching copy in Settings now refers to notes/docs plus AGENTS/skills context rather than inbox state.

## Active run
- run id: none
- task slug: post-release-tool-first-cleanup
- purpose: direct local cleanup of stale product language after the notification surface removal

## Latest validation
- `npx vitest run packages/web/src/components/ContextRail.test.tsx packages/web/src/pages/SettingsPage.test.tsx`
- `npx eslint packages/web/src/components/ContextRail.tsx packages/web/src/components/ContextRail.test.tsx packages/web/src/pages/SettingsPage.tsx packages/web/src/pages/SettingsPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: Settings loaded in the packaged app and the updated profile copy rendered

## Durable loop state
- status: direct continuation in a clean temporary worktree because the main worktree has unrelated dirt
- wakeup policy: none needed for this slice

## Next step
Keep trimming stale notification-era language and dead product concepts, unless the next clearer leverage is another dead admin/status surface that can be deleted outright.
