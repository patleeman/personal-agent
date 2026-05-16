# Activity tree

The activity tree is the shared model for showing conversations, executions, terminals, artifacts, and other work items in one sidebar tree.

Personal Agent's thread sidebar is moving toward an activity tree instead of a conversation-only list. The tree consumes the product-facing **Execution** projection for background work. Durable runs remain the daemon/runtime storage record for logs, checkpoints, recovery, and compatibility; product UI should not infer visible background work from raw run records.

## Item model

Activity items use stable prefixed IDs so different systems can share the same tree without ID collisions:

- `conversation:<conversationId>` for conversation threads
- `execution:<executionId>` for background commands, subagents, and other execution records

Each item carries a `kind`, `title`, optional `parentId`, `status`, `route`, and small metadata payload. The model intentionally stays data-only; UI components and extensions should decorate rows rather than own routing, selection, or keyboard behavior.

## Current implementation

The adapter lives at `packages/desktop/ui/src/activity/activityTree.ts` and currently supports:

- workspace/CWD group items
- conversation items
- execution items projected by `packages/desktop/server/executions/executionService.ts`
- execution nesting via `execution.conversationId`
- normalized status values: `idle`, `running`, `queued`, `failed`, `done`

`packages/desktop/ui/src/activity/activityTreePaths.ts` converts activity items into stable tree paths, and `ActivityTreeView.tsx` is the reusable native React renderer. The Threads sidebar renders workspace groups, conversations, and linked execution records through the shared tree, decorates running/failed/done rows, and exposes workspace actions plus conversation actions for open, pin/unpin, close, archive, copy, duplicate, and extension-provided conversation-list context menu items.

## Execution boundary

Use executions for product UI freshness:

- sidebar pending/running indicators
- activity tree rows
- conversation background-work rail
- background-work detail actions (`cancel`, `rerun`, `follow-up`)

Use durable runs only inside low-level detail/log plumbing, compatibility tools, daemon recovery, and agent-facing `run`/`background_command` APIs. Any durable-run mutation that can affect visible background work must invalidate the `executions` topic; invalidating `runs` alone is not enough.
