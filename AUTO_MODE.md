# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
Another packaged-desktop perf trim is green in the worktree: the saved conversation page no longer eagerly reads global model state while the carried initial prompt is still pending or in flight. During measurement in the packaged shell, local `readModels()` was about `70ms`, and that read was still happening immediately on saved-page mount even though the first prompt path did not need model catalog/default-model data yet. The draft page still loads models eagerly; only the saved conversation path now defers that read until the first prompt clears.

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
- id: `resume_1775880153224_mp5lpzg8`
- why it exists: keep the packaged-desktop perf loop alive for the next measurement pass
- when it should wake up: previously scheduled

## Next step
Commit and push this deferred saved-page model-read trim, then re-measure the packaged local first-response / first-visible-update path for the next smallest remaining delay. Keep the later desktop packaging/signing failure (`chrome_crashpad_handler.cstemp` ENOENT) parked as a separate release-path blocker once the perf/migration loop is closer to done.
