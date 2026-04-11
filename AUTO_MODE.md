# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
A new packaged-desktop perf trim is green in the worktree: freshly created conversations now carry the already-known model/thinking selection through navigation state, so the first saved-conversation open skips an immediate follow-on `conversationModelPreferences` desktop read. `DESKTOP_MIGRATION_PLAN.md` is updated for this slice; commit/push is next before returning to the next packaged first-response / first-visible-update measurement.

## Active run
- run id: none
- task slug: desktop-first-migration-perf-release
- purpose: direct local iteration on the next smallest desktop-first slice

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx`
- `npx eslint packages/web/src/pages/ConversationPage.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- `npm run desktop:dist:dir`
- packaged Electron smoke via `agent-browser`: a draft prompt still opened into the saved-conversation shell with model/thinking controls intact

## Active deferred resume
- id: `resume_1775878058966_ykxs1mxr`
- why it exists: prior wakeup for the ongoing packaged-desktop perf loop
- when it should wake up: previously scheduled; do not stack another unless timing changes materially

## Next step
Commit and push this green slice, then re-measure the packaged local first-response / first-visible-update path for the next small trim.
