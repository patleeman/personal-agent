---
id: personal-agent-inbox-conversation-model
title: "Personal-agent inbox and conversation model"
summary: "Product model for how inbox attention, archived conversations, and asynchronous work should relate."
type: "project"
status: "active"
tags:
  - "personal-agent"
  - "inbox"
  - "conversations"
  - "async"
  - "product"
updated: 2026-03-13
---

# Personal-agent inbox and conversation model

High-signal product guidance for how inbox should relate to conversations.

## Core distinction

- A **conversation** is where a thread of work lives.
- The **inbox** is a durable attention surface for asynchronous things that are not already visible in an active conversation.

## What belongs in inbox

- **Standalone activity** with no conversation, such as scheduled-task output, reports, daemon or gateway events, or imported external signals.
- **Missed scheduled-task runs caused by daemon downtime** should create inbox items so the user can decide whether to rerun them manually.
- **Inactive or archived conversations that now need attention**, such as background work finishing later, resumed conversations, blocked or needs-input states, failures, or new external input.
- **Async internal system events** that change app availability or background automation health, such as web UI restarts/updates, rollbacks, daemon or gateway outages, and their recoveries, when those events are not already visible in an active conversation.

## What should not be duplicated

- Normal foreground replies in an actively viewed conversation should stay in the conversation and should not also create a separate inbox item.
- When background work belongs to a conversation, prefer surfacing that conversation in inbox instead of creating a duplicate standalone activity item.

## Notifications vs inbox

- Treat **inbox entries** as durable “look at this later” resurfacing.
- Treat **notifications** as optional interrupts layered on top of inbox-worthy events, not as a replacement for inbox.
- Only a subset of inbox-worthy events should notify immediately; the key distinction is whether something is already surfaced, not merely whether it exists somewhere in the UI.
- For internal system events, default to durable inbox items first; reserve interrupting notifications mainly for failures, degraded health, or disruptive actions the user can no longer directly watch.
