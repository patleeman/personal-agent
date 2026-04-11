# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
Another packaged-desktop perf trim is green in the worktree: fresh create/open no longer kicks off a live-session git-context read while the initial prompt is still pending or in flight. The packaged shell already has cwd from session meta, so branch/git context can wait until the first prompt clears. Cleanup leverage is effectively exhausted, so the next iteration should keep measuring the packaged local first-response / first-visible-update path for one more small trim.

## Active run
- run id: none
- task slug: desktop-first-migration-perf-release
- purpose: direct local iteration on the next smallest desktop-first slice

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx`
- `npx eslint packages/web/src/pages/ConversationPage.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: a draft prompt still opened into the saved conversation shell, got a response, and kept the route transition around `110ms`

## Active deferred resume
- id: `resume_1775879002684_3t5lxd3l`
- why it exists: keep the packaged-desktop perf loop alive for the next measurement pass
- when it should wake up: about 45 minutes after scheduling

## Next step
Commit and push this git-context deferral trim, then re-measure the packaged local first-response / first-visible-update path for the next smallest remaining delay. Keep the later desktop packaging/signing failure (`chrome_crashpad_handler.cstemp` ENOENT) parked as a separate release-path blocker once the perf/migration loop is closer to done.
