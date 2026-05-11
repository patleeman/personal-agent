# Changelog

## 0.7.9-rc.9 — 2026-05-11

- fix: add missing async to extension enable route handler
- fix: align system extension backend builds
- fix: avoid duplicate desktop runtime setup
- fix: avoid recursive workspace watch on desktop startup
- fix: avoid redundant login-item writes on startup
- fix: batch desktop subscription IPC events
- fix: bridge workspace event stream in desktop
- fix: broadcast session title tool updates
- fix: cache desktop config reads
- fix: cache desktop runtime paths
- fix: center notification toasts at top
- fix: debounce workbench browser state writes
- fix: dedupe related conversation pointer context
- fix: defer desktop about metadata reads
- fix: defer desktop app event subscription after startup
- fix: defer desktop backend startup until after first paint
- fix: defer katex css off desktop startup
- fix: defer renderer startup work
- fix: defer workbench data reads until active
- fix: delay automatic update checks after startup
- fix: disable onboarding after first run
- fix: forward desktop launch args
- fix: hide completed composer goals
- fix: keep desktop navigation off startup critical path
- fix: lazy-load command palette after startup
- fix: offload desktop list reads to worker
- fix: offload workspace reads from desktop main
- fix: open onboarding when enabled
- fix: preserve goal state updates
- fix: reduce desktop startup pressure
- fix: rely on onboarding bootstrap when enabled
- fix: remove stale extension source outputs
- fix: render steer control during streaming
- fix: route settings reads through local api worker
- fix: run extension enable actions
- fix: serve cached desktop assets as uint8 arrays
- fix: skip missing optional release resources
- fix: split desktop main startup chunks
- fix: split workbench panes out of startup bundle
- fix: start desktop backend after renderer settles
- fix: update iOS dev build paths
- fix: warm desktop shell assets on startup
- fix(desktop): cast Uint8Array to BodyInit in app-protocol Response constructor
- chore: log desktop window load milestones
- docs: document desktop startup boundaries
- feat: add first-run onboarding extension
- feat: improve knowledge onboarding

## 0.7.9-rc.8 — 2026-05-11

- idk
- fix: broadcast session title tool updates
- fix: run extension enable actions
- fix: rely on onboarding bootstrap when enabled
- fix: open onboarding when enabled
- fix: always open onboarding before disabling
- fix: disable onboarding after first run
- feat: add first-run onboarding extension
- feat: improve knowledge onboarding
- fix: route settings reads through local api worker
- fix: preserve goal state updates
- fix: skip missing optional release resources
- fix: update iOS dev build paths
- fix: remove stale extension source outputs
- fix: forward desktop launch args
- fix: align system extension backend builds
- fix: center notification toasts at top
- docs: document desktop startup boundaries
- fix: defer desktop app event subscription after startup
- fix: serve cached desktop assets as uint8 arrays
- fix: defer katex css off desktop startup
- fix: warm desktop shell assets on startup
- fix: start desktop backend after renderer settles
- fix: split desktop main startup chunks
- fix: hide completed composer goals
- fix: split workbench panes out of startup bundle
- fix: defer workbench data reads until active
- fix: lazy-load command palette after startup
- fix: delay automatic update checks after startup
- chore: log desktop window load milestones
- fix: defer renderer startup work
- fix: defer desktop backend startup until after first paint
- fix: avoid duplicate desktop runtime setup
- fix: defer desktop about metadata reads
- fix: offload desktop list reads to worker
- fix: avoid redundant login-item writes on startup
- fix: debounce workbench browser state writes
- fix: cache desktop runtime paths
- fix: batch desktop subscription IPC events
- fix: cache desktop config reads
- fix: offload workspace reads from desktop main
- fix: keep desktop navigation off startup critical path
- fix: dedupe related conversation pointer context
- fix: reduce desktop startup pressure
- fix: render steer control during streaming
- fix: avoid recursive workspace watch on desktop startup
- fix(desktop): cast Uint8Array to BodyInit in app-protocol Response constructor
- fix: bridge workspace event stream in desktop

## 0.7.9-rc.7 — 2026-05-11

- fix: reflect running sessions on conversation page
- fix: keep stale running threads steerable
- docs: document agent loop health metrics
- fix: avoid codex port conflict crash
- fix: initialize local deferred resume context
- feat: add agent loop health metrics
- fix: make notifications a top-bar dropdown
- fix: avoid extension toggle page reload
- feat: extract slack mcp gateway extension
- fix: route sidebar errors to notifications
- fix: wrap extension settings panels
- Require prebuilt extension bundles in packaged desktop builds
- fix: sync repeated notification toast counts
- fix: wire conversation model picker handler
- fix: clear blank conversation goal updates
- fix: wire notification center mark-read handler
- fix: remove composer working shelf
- fix: avoid runtime esbuild for packaged system extensions

## 0.7.9-rc.6 — 2026-05-11

- fix: make daemonEntryFile resolution tolerant so packaged build doesn't crash

## 0.7.9-rc.5 — 2026-05-11

- fix: add build:main to desktop build script so electron-builder finds main.js

## 0.7.9-rc.4 — 2026-05-11

- fmt: prettier
- fix: prune transcript blocks in renderer to max 300, reduce default historical tail window to 60/200
- surface session integrity warning in conversation header UI
- fix: cap session meta/search-text caches with LRU eviction (max 500) and throttle scanSessionMetas to 500ms
- detect prompt cache misses on session detail reads with content hash verification
- docs: add v0.7.9-rc.3 release info and dev app instructions to AGENTS.md

## 0.7.9-rc.3 — 2026-05-11

- fix: bump testing codex port to 3846, 3844 already taken by production
- fix: build missing artifacts and resolve port conflict for dev app
- fix notification center UI: compact sizing, visible backgrounds, reposition toasts to bottom-right
- fix: set PERSONAL_AGENT_REPO_ROOT in dev app launch env
- Fix daemon entry file path after daemon→desktop collapse
- chore: checkpoint all uncommitted changes across multiple conversations
- Fix duplicate createRequire declaration in Electron main process
- Fix Dynamic require of process error in Electron main process
- Fix build: resolve daemon→desktop collapse errors, extension builds, and tsc issues
- formatting: fix import ordering and line wrapping from prettier run

## 0.7.9-rc.2 — 2026-05-10

- fix: package esbuild for desktop runtime

## 0.7.9-rc.1 — 2026-05-10

- fix: declare typebox dependency for release builds

## 0.7.9-rc.0 — 2026-05-10

- fix: restore release-blocking tests
- chore: clean dead code check issues
- fix: preserve conversation goal clearing
- fix: manage Telegram gateway token as secret
- docs: backfill changelog releases
- chore: update release changelog process
- fix: keep divider above first extension setting group
- fix: label dictation settings as extension injected
- fix: show extension setting source per group
- fix: move secret backend selector
- feat: add extension secret storage
- feat: show extension source on injected settings
- fix: remove synthetic conversation resume prompt
- fix: default diffs to uncommitted changes
- revert: remove web tools Exa setting
- fix: add frontmatter field creation
- feat: add web tools Exa setting
- fix: prevent title edit icon overlap
- fix: set conversation title through active session
- refactor: simplify goal mode tools
- fix: count real tools as goal progress
- fix: inline conversation title edit actions
- fix: stop goal mode on non-progress tools
- fix: treat get_goal-only turns as idle
- fix: show goal working status inline
- fix: suppress idle goal continuations
- fix: place suggested context on new conversation page
- refactor: extract suggested context shelf extension
- Unify composer goal state handling
- Keep pending goal panel synced with composer input
- Fix goal continuation id crash
- Add regression test for agent extension factory builders
- Normalize agent extension factory exports
- fix: guard against calculateContextTokens crash when assistant usage is missing
- Make agent extension factory async so SDK awaits tool registration
- fix: scope shortcut conflict detection
- Fix formatting in ConversationPage.tsx
- fix: include goal mode in compact composer menu
- Revert NativeExtensionSurfaceHost to bg-base
- Fix extension surface host background to bg-surface
- Fix right rail file explorer background mismatch
- Fix right rail file explorer background mismatch
- Fix knowledge file editor reload loop from vault watcher noise
- Fix knowledge file editor infinite reload loop
- Fix File Explorer tab not loading file tree on initial click
- Consolidate settings page from 9 sections to 4
- fix: style theme default selectors
- feat: add conversation goal mode
- fix: register trace cache efficiency route
- fix: import browser tabs state reader
- fix: restore auto mode trace exports
- fix: initialize composer input before goal mode
- Fix duplicate isRecord function in sessions.ts breaking esbuild bundle
- Fix missing auto-mode types in CompanionRuntime interface
- fix: verify packaged extension style assets
- Fix all build errors: unused imports/vars, empty switch case, and missing break
- fix: build system extension bundles before packaging
- fix: package agent-readable docs with releases
- docs: point agents at extension docs index
- docs: update configuration and settings system map
- docs: clarify extension-first platform boundary
- docs: define PA core versus extensions
- docs: require extension-first feature development
- refactor: remove built-in /run, /search, /think slash commands
- refactor: remove built-in slash commands, add build error surfacing
- feat: auto-build extensions after create/import in extension manager
- refactor: replace hardcoded standalone tool logic with declarative renderer flag
- refactor: remove built-in slash commands and orphaned ArtifactCheckpointToolBlocks
- Unify settings: remove settingsPanels, replace with settingsComponent
- refactor: move AskUserQuestionToolBlock and CheckpointToolBlock into owning extensions
- Consolidate settings: unified settings render in Settings page + quick link
- refactor: move BrowserToolBlock component into system-browser extension
- fix: restore deleted companion types and fix build errors
- refactor: move terminal/bash transcript renderer into system-conversation-tools extension
- refactor: finish extension surface cleanup
- refactor: share Excalidraw extension utilities
- refactor: remove remote session metadata
- Add settings declarations to browser, auto-mode, images, and diffs extensions
- refactor: move transcript renderers into extensions
- feat: extract Excalidraw composer input extension
- refactor: remove remote execution backend
- fix: register gateway attach menu from extension
- fix: unify message action shelves
- Clean up orphaned UnifiedSettingsEntry interface and lint fixes
- refactor: fully own MCP settings in extension
- fix: remove stray conversation log action
- refactor: remove composer gateway popup
- refactor: remove remote workspace run picker
- fix: keep context usage visible before session tokens
- fix: remove scheduled task composer shelf
- feat: move context usage into extension
- feat: move MCP settings into extension
- refactor: remove caffinate feature
- feat: move git status into extension
- fix: standardize settings and extensions pages
- docs: move dictation docs into extension
- feat: register dictation settings panel
- refactor: remove built-in dictation code
- refactor: extract dictation extension
- fix: route runs rail through extension surface
- fix: harden release readiness surfaces
- fix: standardize extension page layout
- fix: use theme appearance for diff viewer
- fix: keep extension registry header elements defined
- Extension surface area: conversationHeaderElements, modal dialogs, events.subscribe, getStatus
- Add extensions.getStatus for availability checks
- Add frontend events.subscribe and wire up cross-extension API
- Update docs with conversationHeaderElements and modal dialog API
- Add conversationHeaderElements slot and extension modal dialog API
- Prettier fix for docs
- Fix lint in test file
- Update SDK README with new surface slots
- Update extension authoring guide with new surface slots
- Prettier fix for settingsStore.ts
- Wire messageActions, conversationDecorators, and contextMenus into system extensions
- Wire system-runs and system-automations into composerShelves slot
- Standardize extension surface usage across system extensions
- Standardize system-caffinate with toolbarActions and statusBarItems slots
- Add statusBarItems extension slot
- Remove native Electron context menus, add contextMenus extension slot
- Add toolbarActions and conversationDecorators extension slots
- Add composerShelves extension slot for shelf sections above composer
- Center extension details modal and replace Details button with icon button
- Add settings nav section for extension-contributed nav items
- Add messageActions extension surface slot with inline rendering
- Restore getExtensionRegistryRevision import in NativeExtensionSurfaceHost
- Add topBarElements extension point, move caffeine indicator into system-caffinate frontend
- Fix extension toggle flash: stable module key, keep old surface during registry re-fetch
- Remove dead server extension files and clean up dependencies
- Lock Extension Manager from being disabled to prevent bootstrap paradox
- Move caffinate feature into system-caffinate extension
- Clean up extension system: remove zen docs, back-end API barrel, systemFactory types, and finalize surface placement model
- Backfill tests for all 11 system extension packages
- fix: load native extension styles
- fix: size knowledge tree panel correctly
- Move extension details from right rail to modal with a Details button per row
- fix: stabilize knowledge tree loading
- fix: cache extension backend modules
- fix: revert simulated dictation streaming
- fix: rebuild extension backends with host runtime imports
- fix: use right sidebar for extension details
- fix: restore extension list scrolling
- fix: close extension actions menu on outside click
- fix: align extension manager toggles
- fix: keep disabled right rail toggle visible
- fix: show knowledge tree on knowledge page
- fix: include extension sources in tailwind scan
- fix: remove browser from left sidebar
- fix: remove deleted summary fork feature
- fix: type summary fork host capability
- fix: restore extension workbench tools
- fix: remove stale summary fork reset
- refactor: simplify extension surface placement
- Remove Summarize & New context menu feature
- fix: keep esbuild external in desktop server
- fix: restore telemetry layout and workspace toggle
- refactor: add extension view placement policy
- fix: clean up telemetry page layout
- fix: use right rail for knowledge files
- fix: stabilize knowledge and settings navigation
- test: remove stale knowledge api coverage
- refactor: remove migrated core pages
- refactor: expose browser tool host through backend api
- fix: stabilize settings extension surface
- refactor: route settings through extension surface
- refactor: remove knowledge extension host facade
- refactor: finish moving knowledge page into extension
- refactor: remove knowledge api host import
- refactor: move knowledge mentions behind extension provider
- feat: split theme mode from color defaults
- refactor: remove knowledge workbench fallback imports
- refactor: remove special knowledge sidebar mode
- chore: remove stale knowledge sidebar imports
- refactor: serve knowledge page as extension surface
- chore: expose empty state UI primitive
- feat: add extension contribution providers
- refactor: trim knowledge extension host facade
- docs: consolidate extension authoring guide
- refactor: route knowledge prompt context through backend seam
- docs: expand extension authoring guide
- refactor: resolve prompt references through extensions
- docs: document extension dependencies
- refactor: discover system extension frontend modules
- fix: keep primary nav on workbench pages
- fix: guard extension renderer manifests
- refactor: route settings page through extension facade
- refactor: route knowledge UI through extension facade
- fix: resolve knowledge extension imports
- test: mock knowledge editor extension actions
- test: mock knowledge extension actions
- refactor: route knowledge host access through extension API
- chore: expose knowledge host package seam
- refactor: route extension frontend imports through host API
- fix: rewind user messages by entry id
- refactor: remove core imports from extensions
- refactor: route knowledge vault operations through extension backend
- refactor: route extension backend data through host seam
- feat: simulate streaming dictation
- refactor: move knowledge settings panel into extension
- chore: stabilize extension extraction checks
- test: cover materialized skill prompt entries
- feat: validate and surface extension skills
- refactor: move knowledge UI primitives into extension
- refactor: remove codex dictation bridge
- refactor: add backend extension import seam
- fix: conform extension skills to agent skill format
- feat: register built-in guidance as extension skills
- feat: move knowledge sync ownership into extension
- feat: copy extension diagnostics
- fix: refresh extension runtime after reloads
- feat: surface invalid extension diagnostics
- feat: validate extension manifest contract
- docs: remove moved feature doc stubs
- docs: add missing extension readmes
- docs: move feature docs into extensions
- refactor: generate menu accelerators from shortcut registry
- refactor: declare core keyboard shortcuts
- refactor: route shortcuts through extension keybindings
- feat: support extension shortcut overrides
- feat: show extension shortcuts in settings
- feat: register extension keybindings
- refactor: clarify extension manager capabilities
- refactor: split extension backend API surface
- refactor: route extension imports through backend api
- refactor: move conversation tools into extension
- refactor: move agent hooks into product extensions
- refactor: discover extension agent hooks
- refactor: package native compaction as extension
- refactor: add extension backend API surface
- fix: restore extension manager scrolling
- feat: add extension manager search filters
- fix: unify transcript history and windowing chrome
- refactor: simplify extension manager layout
- refactor: dogfood extension manager and automations
- fix: keep extension host compatibility buildable
- refactor: move gateways and telemetry into extensions
- refactor: move workbench panels into extensions
- refactor: split extension host frontend APIs
- refactor: add host extension frontend API
- feat: add extension mention providers
- refactor: centralize system extension module loading
- docs: clarify skill-bundled MCP preference
- refactor: move settings implementation into system extension
- refactor: scope extension settings panels
- refactor: move settings route wrappers into system extension
- refactor: move file explorer frontend into system extension
- refactor: move knowledge frontend into system extension
- refactor: move browser frontend into system extension
- refactor: move tool backends into system extensions
- fix: keep viewport inset helper private
- fix: track bare composer modifier keys
- feat: move image tools to extension backend
- feat: move run and scheduled task tools to extension backends
- feat: move conversation queue to extension backend
- feat: move checkpoint and reminders to extension backends
- feat: make checkpoint native extension backend
- feat: make artifacts native extension backend
- feat: add extension transcript renderers
- feat: make web tools native extension backend
- feat: expose extension capabilities
- feat: migrate tool families to system extensions
- feat: add extension skills and tools
- fix: align sidebar background with base
- fix: promote compact panels into workbench
- fix: restore extension browser launch
- fix: restore queued prompts when stopping agent
- docs: document desktop QA cleanup
- feat: let extensions declare route capabilities
- refactor: centralize route capabilities
- feat: generalize extension pathing
- feat: migrate knowledge workbench to extension
- feat: migrate artifacts workbench to extension
- refactor: remove browser state from layout
- feat: migrate browser workbench to extension
- feat: expose workbench browser primitives
- feat: validate paired extension surfaces
- feat: add extension starter templates
- feat: migrate file explorer to workbench extension
- feat: group paired extension surfaces
- feat: migrate diffs to workbench extension
- feat: migrate runs to workbench extension
- feat: add coordinated workbench extension surfaces
- docs: document extension surface choices
- fix: keep runs as core workbench pane
- fix: keep diffs in workbench pane
- feat: add extension build and workspace APIs
- feat: migrate core surfaces to native extensions
- fix: wait for scheduled run creation
- fix: redesign automation editor form
- fix: align automations page redesign
- fix: clean up automations page layout
- fix: keep mission state synced in UI
- test: harden native extension follow-up
- feat: add native extension runtime
- fix: inject mode context after auto mode changes
- docs: define native extension architecture
- fix: align extension iframe theme styles
- Fix window drag region by making top bar center div self-stretch
- Remove turn limit from mission mode
- Restore running status indicators in composer: shelf glow, tools spinner, Working shelf, send button ping
- Add pulsing glow animations for mission and loop modes
- chore: remove legacy apps surface
- Merge branch 'docs/extensions-architecture'
- docs: add extension styling guidance
- feat: port automations to system extension
- feat: wire extension right rail panels
- fix: simplify extensions page layout
- feat: expose extension launch context
- feat: import and export extension bundles
- feat: cache extension backend builds
- feat: add extension lifecycle actions
- feat: show extension commands in palette
- feat: execute extension slash commands
- feat: show extension slash commands
- feat: register extension commands
- feat: expose conversations to extensions
- feat: add extension public types package
- feat: expose vault to extensions
- feat: expose runs to extensions
- feat: add sqlite extension storage
- feat: expose automations to extension backends
- feat: invoke extension backend actions
- feat: add extension manager
- feat: load runtime extension pages
- feat: add extension runtime skeleton
- docs: specify extension runtime architecture

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
