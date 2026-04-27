# Architecture Improvement Plan

This is the running punch list for moving Personal Agent toward an architecture that is easier to test, navigate, and change. The target is not tiny files for their own sake; the target is deep modules with small, stable interfaces and good locality.

## Working principles

- Prefer deep modules: callers should get a lot of behavior through a small interface.
- Extract around real concepts, not file-type buckets.
- Keep behavior stable while refactoring; validate after each slice.
- Checkpoint focused commits as each slice lands.
- Stop if a refactor needs a product decision rather than guessing.

## Current status

### Completed

- Split the live session registry from a large mixed module into focused modules for presence, queue state, transcript merging, loader caching, prompt operations, auto mode, event handling, creation, recovery, branching, summaries, and read APIs.
- Reduced `packages/web/server/conversations/liveSessions.ts` to a registry/facade shape instead of the home for every live-session behavior.
- Preserved server TypeScript validity after the live-session split.

### Active validation baseline

Run these before checkpointing server architecture work:

```bash
npx tsc --noEmit --pretty false --project packages/web/tsconfig.server.json
npx vitest run packages/web/server/conversations/liveSessions.test.ts packages/web/server/conversations/liveSessions.bootstrap.test.ts --reporter=dot
```

For UI architecture work, also run app build/tests and perform a visual check if UI behavior changes.

## Priority backlog

### 1. Conversation page controller split

**Files:** `packages/web/src/pages/ConversationPage.tsx`, `packages/web/src/conversation/*`, `packages/web/src/hooks/*`, `packages/web/src/pending/*`

**Problem:** `ConversationPage.tsx` still owns too many seams directly: draft hydration, pending prompt dispatch, live/draft transition, composer persistence, session stream state, keyboard shortcuts, related threads, model preferences, attachment preparation, and UI rendering.

**Target shape:** turn the page into a renderer over a few deep modules:

- conversation composer controller
- draft/live session lifecycle controller
- keyboard/desktop shortcut module
- attachment/image preparation module
- related-thread selection module

**First slices:**

1. [done] Extract pure attachment/image preparation logic out of `ConversationPage.tsx`.
2. [in progress] Extract draft/pending prompt hydration into controller hooks.
   - Extracted pending-initial-prompt acceptance/dispatch predicates into `pendingInitialPromptLogic`.
   - Extracted initial draft attachment hydration into `useInitialDraftAttachmentHydration`.
   - Extracted pure page state decisions for pending status, loading gates, title/session-list sync, desktop-state selection, model loading, attachment loading, and transcript rail mode into `conversationPageState` with focused tests.
   - Expanded `conversationPageState` to own live-session detection, session-meta merging, background-run indicator text, historical warmup/loading gates, bootstrap loading, and stable-transcript scroll binding.
   - Extracted initial navigation/draft hydration state, model preference carry-over, and service-tier override decisions into `conversationInitialState` with focused tests.
   - Extracted composer presentation decisions for autocomplete catalog demand, mention-to-context-doc mapping, queued/parallel prompt summaries, composer action labels, and git summary chips into `conversationComposerPresentation` with focused tests.
   - Extracted live-session lifecycle helpers for not-live error detection and created-conversation cache priming into `conversationSessionLifecycle` with focused tests.
   - Extracted composer model/thinking/fast/auto preference controls into `ConversationPreferencesRow` with server-render tests so `ConversationPage` no longer owns that component tree.
   - Extracted model, slash-command, and mention autocomplete menu rendering into `ConversationComposerMenus` with server-render tests.
   - Extracted context-usage indicator rendering into `ConversationContextUsageIndicator` with server-render tests.
   - Extracted composer chrome icons, browse-path button, action icons, and shell state-class resolution into `ConversationComposerChrome` with server-render/pure tests.
   - Extracted browser dictation capture and base64 audio encoding into `conversationComposerDictation` with focused boundary tests.
   - Extracted conversation model-list loading into `useConversationModels`, and moved deferred-resume timestamp formatting into `deferredResumeIndicator` with coverage.
   - Extracted related-thread visible-result merging and selection toggling into `relatedThreadSelection` with focused tests.
   - Extracted composer text insertion and history-navigation predicates into `conversationComposerEditing` with focused tests.
   - Extracted attached-context and prompt-reference shelf rendering into `ConversationContextShelf` with server-render tests.
   - Extracted background-run and deferred-resume shelf rendering into `ConversationActivityShelf` with server-render tests.
   - Extracted queued-prompt and parallel-job shelf rendering into `ConversationQueueShelf` with server-render tests.
   - Extracted ask-user-question composer shelf rendering into `ConversationQuestionShelf` with server-render tests.
3. [in progress] Extract keyboard shortcut/event wiring into focused hooks.
   - Extracted viewport keyboard inset and composer modifier-key tracking into `useConversationKeyboardState`.
   - Extracted workspace draft/reply composer event wiring into `useWorkspaceComposerEvents`.
   - Extracted related-thread hotkey selection into `useRelatedThreadHotkeys`.
   - Extracted desktop conversation shortcuts into `useDesktopConversationShortcuts`.
   - Extracted Escape-to-abort stream handling into `useEscapeAbortStream`.
4. Leave JSX migration for last; moving render chunks first tends to create shallow wrappers.

### 2. Desktop local API adapter split

**Files:** `packages/web/server/app/localApi.ts`, `packages/web/server/routes/*`, desktop bridge callers.

**Problem:** `localApi.ts` mixes request dispatch, stream subscription plumbing, desktop wrapper functions, run polling, provider OAuth stream handling, and checkpoint git implementation.

**Target shape:** local API should be a transport adapter. Capability behavior should live behind focused modules.

**First slices:**

1. [done] Extract checkpoint git commit/diff creation into `conversationCheckpointCommit`.
2. [done] Extract desktop stream subscription helpers by stream type.
3. Keep `dispatchDesktopLocalApiRequest` as the small external seam.

### 3. Settings/model provider configuration module

**Files:** `packages/web/src/pages/SettingsPage.tsx`, `packages/web/server/routes/models.ts`, `packages/web/server/models/*`, `packages/web/src/model/*`

**Problem:** Provider/model validation and draft normalization are scattered between UI draft state, route validation, desktop capabilities, persistence, and live-session refresh side effects.

**Target shape:** model-provider configuration owns normalization, validation, persistence intent, and refresh side effects. Settings page renders and submits.

**First slices:**

1. [done] Extract provider/model draft parsing and validation from `SettingsPage.tsx`.
2. Reuse validation between route and desktop capability where it is genuinely the same seam.

### 4. Live-session follow-up hardening

**Files:** `packages/web/server/conversations/liveSession*.ts`

**Problem:** The split is much better, but some extracted modules still rely on registry-shaped host objects and broad imports.

**Target shape:** add direct unit tests for the deepest extracted modules and tighten interfaces where tests expose unnecessary coupling.

**First slices:**

1. [done] Add focused tests for `liveSessionPresence.ts`.
2. [done] Add focused tests for `liveSessionQueue.ts`.
3. [done] Add focused tests for `liveSessionTranscript.ts` merge behavior.
4. Avoid testing every facade; test behavior-heavy modules.

### 5. Chat transcript rendering split

**Files:** `packages/web/src/components/chat/ChatView.tsx`, `packages/web/src/components/chat/*`

**Problem:** `ChatView.tsx` mixes transcript layout, message markdown rendering, skill invocation rendering, durable run blocks, tool blocks, reply selection, and action wiring. That makes UI changes riskier than they need to be and buries testable rendering rules inside a giant component.

**Target shape:** keep `ChatView.tsx` as transcript orchestration while behavior-heavy renderers live in focused modules with small props.

**First slices:**

1. [done] Extract markdown, mention, commit hash, and skill-aware message rendering into `MarkdownMessage.tsx`.
2. [done] Extract reply-selection DOM helpers into a small tested module.
3. [done] Extract summary-preview formatting into a small tested module.
4. [in progress] Extract linked durable-run presentation/rendering after the message renderer seams are stable.
   - Extracted linked-run discovery and compact run-tool preview formatting into `linkedRuns.ts` with focused tests.
   - Extracted linked-run record resolution into `linkedRunResolution.ts` with focused tests.
   - Extracted linked-run polling and status display helpers into focused modules.
   - Moved trace-cluster linked-run collection into the linked-run module.
   - Extracted inline trace run card rendering into `InlineTraceRunCard.tsx`.
5. [done] Extract ask-user-question tool rendering and state helpers into `AskUserQuestionToolBlock.tsx` with focused tests.
6. [done] Extract artifact/checkpoint tool card rendering into `ArtifactCheckpointToolBlocks.tsx`.
7. [done] Extract shared message actions and terminal tool rendering into focused components.
8. [done] Extract image preview, image message block, and image inspection modal into `ImageMessageBlocks.tsx`.
9. [done] Extract user, assistant, context, and summary message rendering into `MessageBlocks.tsx` with focused summary-helper tests.
10. [done] Extract tool metadata, disclosure state, and streaming-status helpers into `toolPresentation.ts` with focused tests.
11. [done] Extract generic tool block orchestration into `ToolBlock.tsx`.
12. [done] Extract thinking, subagent, error, and trace-cluster rendering into `TraceBlocks.tsx`.
13. [done] Extract transcript windowing constants, chunk helpers, and chunk renderer into `chatWindowing.tsx` with focused tests.
14. [done] Extract reply-selection synchronization and context-menu behavior into `useChatReplySelection.ts` with focused menu-position tests.
15. [done] Extract inline trace-run expansion state into `useInlineTraceRunExpansion.ts` with focused tests.
16. [done] Extract transcript windowing state/effects into `useChatWindowing.ts` with focused tests.
17. [done] Extract per-item chat rendering into `ChatRenderItemView.tsx` with focused rail-kind tests.
18. [done] Extract transcript chrome pieces — streaming indicator, windowing badge, and selection context menu — into `ChatTranscriptChrome.tsx` with render tests.

## Next action

Continue Priority 1. `ConversationPage.tsx` is still the highest-risk UI controller; keep extracting pure controller/state seams before touching JSX-heavy rendering.
