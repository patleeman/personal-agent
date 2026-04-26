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

1. Extract pure attachment/image preparation logic out of `ConversationPage.tsx`.
2. Extract draft/pending prompt hydration into a controller hook.
3. Extract keyboard shortcut/event wiring into focused hooks.
4. Leave JSX migration for last; moving render chunks first tends to create shallow wrappers.

### 2. Desktop local API adapter split

**Files:** `packages/web/server/app/localApi.ts`, `packages/web/server/routes/*`, desktop bridge callers.

**Problem:** `localApi.ts` mixes request dispatch, stream subscription plumbing, desktop wrapper functions, run polling, provider OAuth stream handling, and checkpoint git implementation.

**Target shape:** local API should be a transport adapter. Capability behavior should live behind focused modules.

**First slices:**

1. Extract checkpoint git commit/diff creation into `conversationCheckpointCommit` or similar.
2. Extract desktop stream subscription helpers by stream type.
3. Keep `dispatchDesktopLocalApiRequest` as the small external seam.

### 3. Settings/model provider configuration module

**Files:** `packages/web/src/pages/SettingsPage.tsx`, `packages/web/server/routes/models.ts`, `packages/web/server/models/*`, `packages/web/src/model/*`

**Problem:** Provider/model validation and draft normalization are scattered between UI draft state, route validation, desktop capabilities, persistence, and live-session refresh side effects.

**Target shape:** model-provider configuration owns normalization, validation, persistence intent, and refresh side effects. Settings page renders and submits.

**First slices:**

1. Extract provider/model draft parsing and validation from `SettingsPage.tsx`.
2. Reuse validation between route and desktop capability where it is genuinely the same seam.

### 4. Live-session follow-up hardening

**Files:** `packages/web/server/conversations/liveSession*.ts`

**Problem:** The split is much better, but some extracted modules still rely on registry-shaped host objects and broad imports.

**Target shape:** add direct unit tests for the deepest extracted modules and tighten interfaces where tests expose unnecessary coupling.

**First slices:**

1. Add focused tests for `liveSessionPresence.ts`.
2. Add focused tests for `liveSessionQueue.ts`.
3. Add focused tests for `liveSessionTranscript.ts` merge behavior.
4. Avoid testing every facade; test behavior-heavy modules.

## Next action

Start with Priority 4 test hardening, then move to Priority 1. The live-session split is already done; tests will lock the new seams before the next architecture pass moves to the front-end.
