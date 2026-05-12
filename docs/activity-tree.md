# Activity tree

The activity tree is the shared model for showing conversations, runs, terminals, artifacts, and other work items in one sidebar tree.

Personal Agent's thread sidebar is moving toward an activity tree instead of a conversation-only list. The first slice is a typed adapter that turns conversation metadata and durable run records into stable tree items. Conversations are root items, and runs with conversation metadata are nested under their source conversation.

## Item model

Activity items use stable prefixed IDs so different systems can share the same tree without ID collisions:

- `conversation:<conversationId>` for conversation threads
- `run:<runId>` for durable runs

Each item carries a `kind`, `title`, optional `parentId`, `status`, `route`, and small metadata payload. The model intentionally stays data-only; UI components and extensions should decorate rows rather than own routing, selection, or keyboard behavior.

## Current implementation

The adapter lives at `packages/desktop/ui/src/activity/activityTree.ts` and currently supports:

- workspace/CWD group items
- conversation items
- durable run items
- run nesting via `manifest.spec.conversationId`, `manifest.spec.threadConversationId`, result metadata, or checkpoint payload metadata
- normalized status values: `idle`, `running`, `queued`, `failed`, `done`

`packages/desktop/ui/src/activity/activityTreePaths.ts` converts activity items into stable tree paths, and `ActivityTreeView.tsx` is the reusable native React renderer. The Threads sidebar renders workspace groups, conversations, and linked durable runs through the shared tree, decorates running/failed/done rows, and exposes workspace actions plus conversation actions for open, pin/unpin, close, archive, copy, duplicate, and extension-provided conversation-list context menu items.
