# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
A new packaged-desktop perf trim is green in the worktree: freshly created conversations now carry an initial empty deferred-resume state through navigation, so the first saved-conversation open skips an immediate `readConversationDeferredResumes(...)` desktop read. Cleanup leverage remains very thin, so the next iteration should keep measuring the packaged local first-response / first-visible-update path for another small trim rather than broadening cleanup.

## Active run
- run id: none
- task slug: desktop-first-migration-perf-release
- purpose: direct local iteration on the next smallest desktop-first slice

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx`
- `npx eslint packages/web/src/pages/ConversationPage.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- packaged Electron smoke via `agent-browser`: a draft prompt still opened into the saved conversation shell, got a response, and the measured route transition was about `110ms`

## Active deferred resume
- id: `resume_1775878058966_ykxs1mxr`
- why it exists: prior wakeup for the ongoing packaged-desktop perf loop
- when it should wake up: previously scheduled; do not stack another unless timing changes materially

## Next step
Commit and push this green deferred-resume open-path trim, then re-measure the packaged local first-response / first-visible-update path for the next small trim. Keep the later desktop packaging/signing failure (`chrome_crashpad_handler.cstemp` ENOENT) parked as a separate release-path blocker once the perf/migration loop is closer to done.
