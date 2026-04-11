# Auto Mode State

## Goal
Finish the desktop-first migration/perf cleanup to a solid foundation, then verify the repo builds, build the mac desktop app, and ship a new desktop release if release prerequisites are available.

## Current status
A second packaged-desktop perf trim is green in the worktree: saved conversation attachments now load only when the drawings picker opens, instead of on every conversation open. This keeps the draft-create/open path and normal conversation switches from paying an attachment-list read for a hidden modal path.

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
Commit and push this green slice, then re-measure the packaged local first-response / first-visible-update path for the next small trim.
