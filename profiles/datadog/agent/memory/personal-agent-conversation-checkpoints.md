---
id: personal-agent-conversation-checkpoints
title: "Personal-agent conversation checkpoints"
summary: "Product model for reusable conversation checkpoints as immutable saved anchors that can spawn multiple branches."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "conversations"
  - "checkpoints"
  - "branching"
  - "product"
updated: 2026-03-13
---

# Personal-agent conversation checkpoints

High-signal product guidance for reusable saved branch points inside a conversation.

## Core model

- A **checkpoint** is an immutable saved anchor at a specific point in a conversation.
- A single checkpoint can spawn many future branch conversations over time; branches should keep lineage via something like `parentCheckpointId`.
- Checkpoints should be durable reusable objects, not just one-off fork actions.

## Snapshot semantics

- Define a checkpoint as a snapshot of **conversation content up to the anchor**, not as a promise to recreate full tool or filesystem state.
- If checkpoints must survive source conversation deletion or archiving, store a **materialized snapshot** at checkpoint creation time or otherwise guarantee the source messages are never hard-deleted.
- An optional generated summary can help discovery and search, but it should not replace the frozen raw snapshot.
- Model drift after branching is acceptable; regenerated responses may differ from the original thread.

## UX expectations

- Users should be able to save a checkpoint from a message, give it a title, and optionally add a note.
- Starting a new conversation from a checkpoint should seed the new branch from the frozen snapshot and show its lineage.
- Because the checkpoint is explicitly conversation-scoped, state drift in external tools or files matters less than for a full environment snapshot.
