---
id: web-ui
createdAt: 2026-03-10T10:00:00.000Z
updatedAt: 2026-03-11T02:14:00.000Z
---
# Summary

## Objective

Make the web UI the primary inbox-first shell for local `personal-agent` work while staying aligned with the conversation/artifact/activity model.

## Current plan

See [plan.md](./plan.md).

## Status

- In progress

## Blockers

- The right rail still needs task previews, related activity, and artifact previews to complete the full durable-work-context model.

## Completed items

- Built `packages/web` with inbox, conversation, project, task, and memory routes.
- Added live Pi session create/resume/stream/fork flows.
- Added the context rail, model picker, theme toggle, and shell polish.
- Hooked the web shell up to durable activity/project files and daemon task state.
- Made deferred resume write durable activity records for scheduling and delivery.
- Added durable conversation ↔ project links plus attach/remove controls in the conversation rail.
- Restored a clean web workspace build by making `packages/web` build its internal package deps first.
- Added a visible web profile switcher backed by profile list/current-profile APIs so profile mismatches are obvious and fixable in-app.
- Removed `Recent Messages` from the conversation rail.
- Reworked the project section to avoid redundant empty-state / nested attach-box UI.
- Added focused project summary + plan rendering in the conversation rail.
- Added tested helper logic for focus selection and plan progress.
- Verified the updated rail in-browser with Agent Browser.

## Open tasks

- Add task previews to the conversation rail.
- Add recent related activity to the conversation rail.
- Add artifact previews to the conversation rail.
- Add attention ranking / bubbling based on activity.
- Integrate gateway continuity more intentionally.
- Consider whether the profile switcher should also surface stronger "current profile" status outside the sidebar on narrower layouts.
