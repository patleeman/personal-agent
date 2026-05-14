# Changelog

## 0.8.0-rc.8 — 2026-05-14

- Fix packaged experimental extension discovery and conversation startup

## 0.8.0-rc.7 — 2026-05-14

- Add companion app group entitlement for shared container
- fix: expose companion and codex APIs
- chore: restore clean check formatting
- test: lock goal mode loop scenarios
- fix: harden goal mode integration edges
- fix: resolve pnpm without sourcing shell rc files
- test: cover realistic goal mode lifecycle
- fix: avoid sourcing shell rc files in pre-commit hook
- fix: harden goal mode state machine
- fix: stop goal continuations after completion
- Remove audit marker (work already documented in knowledge base)
- Add audit completion marker
- Restore systemKnowledgeExtensionSurface with toolSlot lookup; add toolSlot:knowledge to system-knowledge extension
- Fix TypeScript errors: remove unused import, fix secrets.get generic type
- Fix llama-cpp: use ctx.shell.exec instead of node:child_process.spawn (bypasses forbidden import)
- Fix llama-cpp experimental extension: network permission format, rebuild extension dist bundles
- Remove getPiAgentRuntimeDir from images backend API, add to runtime module as getRuntimeDir; add better-sqlite3 to forbidden imports
- Enforce extension API boundary at build time: add @personal-agent/core and @personal-agent/daemon to forbidden backend imports
- Decouple extension discovery: add extensionEntries/extensionDirs to ResolveResourceOptions, allow host to inject extension entries into resource resolution
- Remove hardcoded extension IDs from desktop UI: add toolSlot to view contributions, use slot-based lookups in Layout/Sidebar/workbenchNav/ConversationPage
- Fix settings page
- Add llama cpp
- Fix system-suggested-context violations: migrate to extension API, add conversation search/block/summary/trace APIs
- Switch pre-commit hook from npx to pnpm
- Fix extension API boundary violations: add secrets + setEnabled to ExtensionBackendContext, migrate 4 extensions from direct core/server imports
- Add secrets capability to ExtensionBackendContext, fix system-web-tools server import violation
- Fix pre-commit hook PATH resolution for non-interactive git env
- Throttle streaming auto-scroll to fix scroll-up fighting during thinking
- Add runtimeDir and profileSettingsFilePath to ExtensionBackendContext API
- feat: configure additional extension search paths
- fix: prefer checkout extension manifests in tests
- refactor: load experimental extensions from experimental folder

## 0.8.0-rc.6 — 2026-05-13

- docs: document extension authoring tool contracts
- feat: surface extension doctor in manager ui
- feat: add extension validation routes
- feat: add extension manager authoring doctor
- docs: expand local extension development skill
- feat: add local extension development skill
- fix: surface hidden extension bundle errors
- feat: expose compaction end events
- Deprecate dynamic active tool mutation
- Keep browser tool surface stable
- Fix goal mode completion loop guards
- Fix remaining tool smoke failures
- Fix extension tool smoke failures
- Show knowledge setup progress
- Fix knowledge base setup input handling

## 0.8.0-rc.5 — 2026-05-13

- fix: route clipboard writes through desktop ipc

## 0.8.0-rc.4 — 2026-05-13

- fix: resolve packaged conversation inspect worker

## 0.8.0-rc.3 — 2026-05-13

- fix: package bundled extension runtime metadata

## 0.8.0-rc.2 — 2026-05-13

- fix: bundle desktop renderer API dependencies

## 0.8.0-rc.1 — 2026-05-13

- chore: package experimental extensions for release
- fix: retry failed desktop local API startup

## 0.8.0-rc.0 — 2026-05-13

- Guard trace-db token counters against fractional/NaN values
- Preserve composer text when changing model
- Migrate repo installs and scripts from npm to pnpm
- Redesign automations page and add row delete
- Add MLX search clear control
- Improve MLX model search selection
- Remove root postinstall and document explicit hook setup
- Fix overdue one-time automations display
- Fix extension manager action feedback
- Force MLX toggle dimensions
- Fix expanded internal-work bash shelf rendering
- Fix MLX enable toggle layout
- Polish MLX local models page layout
- Group normal bash tool calls inside internal work
- Hide disabled extension UI contributions
- Make Codex companion protocol experimental
- Load repo experimental extensions
- Make session exchange experimental
- Group experimental extensions in manager
- Generalize qwen mlx experimental extension
- Run durable subagents through internal agent runner
- Rename Codex protocol companion app copy
- Add smoke coverage for repaired agent tools
- Fix bash transcript event rendering for agent tool calls
- Fix extension-backed agent tool regressions
- Restore the Artifacts workbench nav entry
- Make onboarding auto-open one-shot
- Fix background invalidation refetches for conversation wakeups
- Fix onboarding refresh loop and sidebar bounce
- Fix direct loading of prebuilt extension backends
- Fix conversation_inspect live session visibility
- Fix artifact transcript renderer registry loading
- Handle background command lifecycle directly
- Preserve shell semantics for foreground bash
- Fix background bash extension action
- fix: avoid false positive backend bundle process scan
- fix: handle nullable process stdio streams
- fix: route diff checkpoints through shell capability
- fix: route codex extension commands through shell capability
- fix: scope extension process import guard
- feat: centralize process launching
- docs: clarify full seam implementation guidance
- feat: add process wrapper registration seam
- Fix system-runs bash action import path
- fix: make extension backend require available
- refactor: clean up background work guidance
- chore: add experimental extensions repo
- feat: support background bash commands
- feat: split runs into background work surfaces
- fix: place composer extension buttons by slot
- fix: provide require shim for extension backend bundles
- fix: toggle workspace row on click
- fix: keep dictation button in action slot
- fix: stop showing archived threads as activity fallback
- fix: align activity tree row controls
- fix: restore activity tree thread status indicators
- fix: make dictation insertion visible
- feat: finish activity tree workspace controls
- fix: move fast mode next to model picker
- fix: surface extension action failures
- refactor: remove legacy extension telemetry exports
- fix: allow activity tree workspace collapse
- feat: group activity tree threads by workspace
- feat: expose extension telemetry API
- fix: avoid duplicate extension backend require banner
- fix: use standard activity tree context menu shell
- feat: add inline activity tree archive action
- fix: collapse activity tree runs by default
- fix: only show linked runs in activity tree
- fix: hide live conversation runs from activity tree
- fix: tighten activity tree thread list
- fix: parse local dictation transcripts
- test: stabilize iOS duplicate prompt guard
- fix: serve extension frontend bundles as javascript
- fix: retry rebuilt extension frontend imports
- fix: render activity tree before styles load
- fix: preserve open file order
- fix: cap iOS composer send icon
- fix: bundle frontend extension SDK modules
- fix: stop diff rail from falling back to files
- fix: repair desktop dictation controls
- fix: show archived sessions in activity tree
- fix: clear workspace file pane on tab close
- fix: declare iOS companion orientation support
- fix: keep extension diffs rail active
- fix: show active thread in activity tree
- fix: emit activity tree parents as directories
- test: cover thread color backend
- fix: keep iOS archived empty state visible at max text
- fix: sort command palette imports
- docs: note activity tree extension menus
- feat: surface extension menus in activity tree
- docs: document activity tree thread colors
- feat: expose thread colors in activity tree
- feat: add thread color style provider
- fix: stack iOS settings host rows for accessibility text
- fix: clean up stale quick open scopes
- fix: handle file rail extension workbench detail
- feat: apply activity tree style providers
- feat: support activity tree row colors
- feat: add more activity tree thread actions
- docs: note activity tree conversation actions
- feat: port activity tree conversation actions
- docs: document quick open surface sdk
- fix: sync goal mode tools on turn start
- feat: make quick open extension surfaces
- fix: show workspace file detail pane
- docs: update activity tree capabilities
- feat: add activity tree context menu
- fix: link activity runs from manifest source
- feat: decorate activity tree statuses
- feat: make quick open an extension surface
- docs: document activity tree sidebar mode
- feat: add activity tree sidebar mode
- fix: move quick open files to knowledge
- feat: add Pierre activity tree renderer
- feat: add activity tree extension points
- fix: guard desktop media permission details
- feat: add activity tree model
- fix: replace unsupported prompt dialogs
- feat: move goal mode into composer extension controls
- fix: enable desktop dictation microphone
- fix: skip simulator app group lookup without opt-in
- fix: keep iOS host pairing empty state accessible
- feat: add extension self-test telemetry
- fix: resolve tool-updated conversation titles
- fix: avoid duplicate thinking control
- fix: route diffs rail clicks through diff handler
- fix: stack iOS trace summaries for accessibility text
- fix: remove stale tsc output from server/ and add .gitignore
- feat: surface extension health failures
- fix: add missing required fields to writeTraceStats test call
- fix: harden SQLite resilience — periodic WAL checkpoint, synchronous=FULL, exit safety net, close all DBs, prune stale files
- fix: restore settings panel dividers
- refactor: use focused backend extension subpaths
- fix: render knowledge base settings panel
- test: add packaged extension smoke check
- fix: checkpoint and close SQLite DBs on daemon shutdown to prevent index corruption
- fix: defer iOS composer height updates
- fix: narrow artifact backend bundle
- fix: repair index-only SQLite corruption with REINDEX before full recovery
- test: remove duplicate suggested context pruning case
- fix: prune stale suggested context telemetry
- fix: tighten extension manager rows
- Add timeout for knowledge extension API calls
- feat: surface knowledge repo settings
- fix: prevent overlapping daemon starts
- fix: reliably auto-open iOS demo conversations
- fix: bundle pi runtime into extension backends
- fix: rename gateways nav to telegram gateway
- fix: remove duplicate settings shortcut
- fix: cap iOS conversation list action icons
- fix: cap iOS knowledge row icons
- fix: wrap archived empty state on iOS
- fix: defer iOS knowledge navigation consumption
- fix: avoid TextKit compatibility switch in composer
- fix: cap iOS conversation header icons
- fix: use valid iOS branch icon
- chore: clean up iOS companion warnings
- test: correct iOS conversation row fixture
- fix: align iOS mock knowledge root
- fix: render transcript markdown blocks on iOS
- fix: harden companion prompt streaming
- fix: avoid iOS layout mutation on conversation create
- fix: keep new iOS conversations open
- fix: subscribe before iOS prompt submission

## 0.7.10-rc.0 — 2026-05-12

- fix: harden session export menu action
- fix: use file picker for session imports
- fix: harden goal mode continuations

## 0.7.9 — 2026-05-12

- Release maintenance

## 0.7.9-rc.11 — 2026-05-12

- feat: update codex extension protocol support
- test: cover conversation inspect extension cache worker
- feat: add session import export extension
- fix desktop launch mode type
- fix: show extension descriptions in manager
- fix: respond immediately to codex turn start
- feat: package RC desktop app separately
- fix: load bundled conversation inspect worker from extension cache
- fix: enable pull to refresh on iOS tab list
- Fix companion conversation fork types
- fix: tolerate missing session integrity telemetry API
- Fix companion server fork branch type imports
- fix: start idle deferred follow-up resumes
- fix: resolve inspect worker from extension cache
- Fix iOS scroll on conversation list (scrollBounceBehavior) and history loading (tailBlocks 5→200)
- Fix transcript newline rendering with inlineOnlyPreservingWhitespace markdown parsing
- Add fork/branch API and iOS UX for conversation branching parity
- fix: surface conversation queue wakeups
- fix: isolate ios daemon and recover runtime db
- fix: isolate daemon runtime storage
- fix: clear completed goal state
- fix: render terminal bash blocks in core chat
- fix: properly unsubscribe notifier from thread subscriber group in codex protocol
- fix: use correct cwd field in codex cwd_changed event forwarder
- fix: notify Codex client on turn/interrupt to avoid hanging turns
- fix: harden iOS companion live QA flows
- fix: keep prompts flowing when run db is corrupt
- Fix duplicate daemon client import
- fix: stop goal mode no-progress loops
- feat: persist server timing metrics
- fix: import legacy sync observability stores
- refactor: route config read failures through telemetry
- test: assert shared observability database
- docs: clarify observability migration comments
- docs: align trace declarations with observability storage
- fix: namespace observability migrations
- fix: cap iOS companion transcript snapshots
- fix: cap unified observability trace tables
- refactor: route server diagnostics through logger
- feat: unify observability storage
- fix: support companion websocket token fallback
- Fix npm run check exit code (knip non-blocking), add testing workflow table to AGENTS.md
- Fix npm run check pipeline — move knip after extension check so extension tests actually run (&& was blocked by knip exit 1)
- fix: route desktop companion calls through api proxy
- fix: cap telemetry and ignore broken pipe logging
- Wire extension quick check into npm run check pipeline, update AGENTS.md
- fix: restore iOS companion daemon transport
- Add visible skip message when QUICK_EXTENSION_CHECK is set
- fix: proxy companion API from built desktop app
- Add extension validation commands to README.md dev section
- Add check:extensions to AGENTS.md npm scripts documentation
- fix: ignore idle web live runs during recovery
- Add npm run check:extensions and check:extensions:quick scripts, env-var-based quick-skip for slow test, update docs
- Add dynamic import test for backend modules to catch module-scope runtime errors (+1 test, 79 total, 93 combined)
- fix: import native context menu guard in sidebar
- Add stale build detection test (checks dist files are newer than source), update docs (+1 test, 78 total, 92 combined)
- Add UTF-8 BOM check, system- naming convention check, update docs (+2 tests, 77 total, 91 combined)
- Fix component export regexes in template literals (single backslash -> double backslash), add status bar item + transcript renderer component export validation
- Add frontend bundle syntax check, update docs (+1 test, 75 total, 89 combined)

## 0.7.9-rc.10 — 2026-05-12

- Update docs for 74 tests and extended cross-extension conflict coverage
- Add cross-extension conflict checks for mentions, prompt references, context providers, quick open providers (+4 tests, 74 total)
- Add Node.js syntax check for prebuilt backend bundles, update docs (+1 test, 70 total, 84 combined)
- Add duplicate env variable detection, improve startup action validation (+1 test, 69 total)
- Add version field check, settings key format check, nav badgeAction validation (+3 tests, 68 total)
- Update extension testing docs table for 65 tests / 12 categories
- Add action reference validation, settings type consistency, secret env format checks (+3 tests, 65 total)
- Add extension testing docs, tool validation, frontend component checks, extension API smoke tests
- Add tool validation, frontend component checks, extension API smoke tests (+19 tests, 76 total)
- Add extension integration smoke test suite (12 new sections, 57 total tests)
- Add extension integration smoke test suite
- fix: narrow checkpoint backend API import
- Revert "fix: force Codex conversations to SSE transport"
- fix: force Codex conversations to SSE transport
- fix: anchor conversation scroll button
- fix: clarify non-json api responses

## 0.7.9-rc.9 — 2026-05-11

- fix: add missing async to extension enable route handler
- fix: guard session info title update against undefined name
- fix: clean up rc.9 changelog (remove duplicate entries)
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
