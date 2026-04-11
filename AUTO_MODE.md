# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
Two small packaged-desktop conversation-open trims are now landed on `master`: freshly created conversations reuse their known model/thinking selection on first open, and saved conversation attachments now load only when the drawings picker opens instead of on every conversation switch. The repo is clean at `f699043f`; the next iteration should go back to packaged first-response / first-visible-update measurement.

## Active run
- run id: none
- task slug: desktop-first-migration-perf-release
- purpose: direct local iteration on the next smallest desktop-first slice

## Latest validation
- `npx vitest run packages/web/src/pages/ConversationPage.test.tsx`
- `npx eslint packages/web/src/pages/ConversationPage.tsx packages/web/src/pages/ConversationPage.test.tsx`
- `npm --prefix packages/desktop run build`
- `npx electron-builder --config electron-builder.json5 --dir`
- packaged Electron smoke via `agent-browser`: draft-create still landed in the saved conversation shell and `/drawings` still opened the drawings picker modal

## Active deferred resume
- id: `resume_1775878058966_ykxs1mxr`
- why it exists: prior wakeup for the ongoing packaged-desktop perf loop
- when it should wake up: previously scheduled; do not stack another unless timing changes materially

## Next step
Re-measure the packaged local first-response / first-visible-update path and land the next small high-confidence trim, or stop cleanly if the next blocker is external.
