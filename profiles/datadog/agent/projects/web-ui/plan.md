---
id: web-ui
updatedAt: 2026-03-11T02:14:00.000Z
---
# Plan

## Objective

Make the web UI the primary inbox-first shell for local `personal-agent` work while keeping it aligned with the canonical conversation/artifact/activity model.

## Current slice

Implement the **conversation right rail as durable work context**.

That means:

- remove transcript-like `Recent Messages` from the right rail
- make one **focused project** the primary context for a conversation
- show the focused project's summary, plan, tasks, activity, and artifacts in the rail
- keep the rail useful for work pickup without turning it into a project-management UI

## Steps

- [x] Build the base web shell and routing
- [x] Add inbox, conversations, projects, tasks, and memory surfaces
- [x] Add live Pi session create/resume/stream/fork support
- [x] Add the right-side context rail and shell polish
- [x] Make deferred resume emit durable activity visible in the inbox
- [x] Add persistent conversation ↔ project links and surface them in the conversation context rail
- [x] Keep workspace install/build/browser verification green
- [x] Add an explicit profile switcher so the active profile is visible and changeable in the web shell
- [x] Remove `Recent Messages` from the conversation rail
- [x] Define focused-project behavior for a conversation
  - [x] if one linked project exists, focus it automatically
  - [x] if multiple are linked, allow explicit focus selection
  - [ ] default focus should later be able to follow attention/activity
- [x] Add aggregated conversation-work-context API data for the rail
  - [x] focused project summary
  - [x] plan progress
  - [ ] task previews from `tasks/`
  - [ ] recent related activity
  - [ ] artifact previews from `artifacts/`
- [x] Render focused project summary block in the conversation rail
  - [x] objective
  - [x] status
  - [x] blockers
- [x] Render focused project plan block in the conversation rail
  - [x] compact checklist
  - [x] progress counts / percentage
- [ ] Render focused project task block in the conversation rail
  - [ ] show project **tasks**, not daemon scheduled tasks
  - [ ] sort active / blocked / failed items before completed ones
- [ ] Render recent related activity block in the conversation rail
  - [ ] prefer activity tied to the focused project
  - [ ] include conversation-linked activity when useful
- [ ] Render artifact block in the conversation rail
  - [ ] show a compact list of durable outputs
  - [ ] link through to the project page for deeper inspection
- [ ] Keep attach/remove related-project controls, but demote them below focused work context
- [ ] Align the project page and the conversation rail around shared section primitives / data shapes
- [ ] Add tests for the aggregated project context path and UI rendering
- [ ] Verify the updated rail in-browser with Agent Browser
