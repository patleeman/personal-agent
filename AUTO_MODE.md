# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
Another packaged-desktop perf trim is green in the worktree: the saved conversation page now defers file-backed conversation refreshes while the carried initial prompt is still pending or in flight. During measurement on the packaged local path, a direct fresh `readConversationBootstrap(...)` came in around `512ms` and `readSessionDetail(...)` around `58ms`, and those refreshes could still get pulled back onto the hot path as soon as session-file invalidations started. The page now holds its current conversation file version steady until the carried prompt clears, instead of immediately refetching bootstrap/session-detail data mid-startup.

## Active run
- run id: none
- task slug: desktop-first-migration-perf-release
- purpose: direct local iteration on the next smallest desktop-first slice

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx`
- `npx eslint packages/web/src/pages/ConversationPage.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: a draft prompt still opened into the saved conversation shell, got an assistant reply, and the desktop bridge was present

## Active deferred resume
- id: `resume_1775883969589_0ic6ju1o`
- why it exists: keep the packaged-desktop perf loop alive for the next measurement pass
- when it should wake up: previously scheduled

## Next step
Commit and push this deferred file-refresh trim, then re-measure the packaged local first-response / first-visible-update path for the next smallest remaining delay. Keep the later desktop packaging/signing failure (`chrome_crashpad_handler.cstemp` ENOENT) parked as a separate release-path blocker once the perf/migration loop is closer to done.
