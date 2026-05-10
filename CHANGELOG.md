# Changelog

## 0.7.8 — 2026-05-07

- Stabilized live conversation running state and repaired related test regressions
- Refined mission task controls, including task preservation and coverage
- Redesigned the composer preferences row with inline thinking, mode badge, and Chat naming
- Added Knip dead-code checking and tuned the release baseline

## 0.7.7 — 2026-05-07

- Split live session internals into smaller modules and simplified continuation handling
- Added distinct run-mode composer controls, editable fields, and clearer mode glows
- Migrated Pi runtime packages to the `@earendil-works` namespace
- Cleared release-blocking lint and stale lock issues

## 0.7.6 — 2026-05-07

- Reworked auto mode into a mission/run-mode flow, then removed the abandoned mission bar artifacts
- Added persistent turn-level idempotency guards for continue flows
- Fixed OAuth URL handling through the desktop shell
- Fixed iOS knowledge query ID encoding

## 0.7.5 — 2026-05-06

- Expanded application, durable run, system health, and conversation telemetry coverage
- Improved prompt cache metrics, request cache-hit tracking, and trace throughput calculation
- Normalized legacy bash/apply-patch telemetry labels and removed the apply-patch agent tool
- Fixed orphaned iOS tool update/completion rendering

## 0.7.4 — 2026-05-06

- Added skill app infrastructure: PA client APIs, `/api/apps`, scaffold support, workbench apps, and Apps navigation
- Restyled Apps and Telemetry pages and hid the right sidebar on app pages
- Added shared tree UI primitives for knowledge and workspace explorers
- Made checkpoint pre-commit failures visible and easier to diagnose

## 0.7.3 — 2026-05-05

- Hardened telemetry architecture and added suggested-context pointer usage tracking
- Improved telemetry accuracy for token deltas, cache writes, hit rates, TTL pruning, and system prompt tokens
- Removed dead trace queue, quick-open, and trace flame graph code
- Improved diffs rail behavior for uncommitted changes

## 0.7.2 — 2026-05-05

- Fixed conversations staying stuck as running after gateway prompts complete
- Added top-bar caffeine status while the daemon keeps the machine awake
- Fixed Telegram detached conversation handling and tab auto-open
- Removed auto-title wiring, setting, and API
- Fixed OAuth login by opening URLs in the system browser

## 0.7.1 — 2026-05-05

- Hardened knowledge-base sync with backups, validation, and auto-restore against empty remote snapshots
- Added SQLite schema migrations and pre-migration database backups
- Added cache efficiency and system prompt telemetry
- Fixed auto-scroll behavior during streaming
- Made `ask_user_question` terminate turns correctly after asking

## 0.6.4 — 2026-05-03

- Fixed system prompt assembly by moving template rendering to materialization
- Removed unsupported `before_agent_start` system-prompt overrides and added a guard

## 0.6.3 — 2026-05-03

- Upgraded Electron from 31.7.7 to 38.8.6 and migrated deprecated navigation APIs
- Moved `conversation_inspect` work off the main thread to prevent UI freezes

## 0.6.2 — 2026-05-03

- Improved checkpoint tool descriptions and prompt guidelines
- Gated image tool registration behind OpenAI provider availability
- Fixed file explorer folder expansion and diff-view collapse behavior
- Saved and restored per-conversation workbench window state
- Hardened diff rendering against CodeMirror and large-overlay crashes

## 0.6.1 — 2026-05-02

- Added renderer crash logging and file-based process logging
- Added SSE auto-reconnect when the daemon restarts or connections drop
- Fixed tray destroy races and slowed aggressive conversation warming
- Backfilled local storage and conversation model hook tests

## 0.6.0 — 2026-05-02

- Prepared the repo for open source with public package metadata and repository URLs
- Fixed desktop UI build/dist resolution across Vite and desktop environment paths
- Added editable built-in model context windows with max context caps
- Added auto-mode context file path injection to controller and continuation prompts
- Removed production `Model<any>` usage and fixed related build issues

## 0.5.35 — 2026-05-02

- MIT license
- Docs and README aligned for open source
- All personal references removed from codebase

## Earlier releases

See git history for the full log.
