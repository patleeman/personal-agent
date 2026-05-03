# Conversations

Conversations are live agent threads. Each conversation has a transcript, a composer, access to tools, and full message history.

## Starting a Conversation

Create a new conversation from the sidebar (`+` button) or navigate to `/conversations/new`. The composer appears at the bottom of the transcript pane.

Type a message and press Enter to send it to the agent. The agent processes the prompt, calls tools as needed, and streams the response.

## Composer

The composer is the text input area at the bottom of the conversation view.

| Feature           | How                                      |
| ----------------- | ---------------------------------------- |
| Send message      | Enter                                    |
| New line          | Shift+Enter                              |
| File reference    | Type `@` to fuzzy-search workspace files |
| Image paste       | Ctrl+V or drag image into composer       |
| Binary attachment | Drag file into composer                  |

## Session Lifecycle

Conversations are saved automatically. Every message, tool call, and tool result is persisted. Past conversations appear in the left sidebar. Click any conversation to resume it.

| State  | Behavior                              |
| ------ | ------------------------------------- |
| Active | Agent is processing a prompt          |
| Idle   | Waiting for user input                |
| Saved  | Persisted to disk, visible in sidebar |

## Branching

Conversations support tree-style branching. Each turn creates a node in the conversation tree.

### /fork

Create a new conversation from a previous user message. The new conversation starts fresh but carries the context up to that point.

```
Original thread:

  ┌─ msg1 ─ msg2 ─ msg3 ─ msg4 (current)

Fork from msg2:

  ┌─ msg1 ─ msg2 (forked)
                └─ msg5 ─ msg6 (new thread)
```

### /tree

Navigate the conversation tree to any previous point and continue from there without creating a new file.

```
  ┌─ msg1 ─ msg2 ─ msg3 ─ msg4 (branch A, current)
  │
  └─ msg5 ─ msg6 (branch B)

/tree navigates to msg5, continue from there.
```

### /clone

Duplicate the current active branch into a new conversation file. Useful before making experimental changes.

## Async Follow-Through

While the agent is processing, you can queue additional messages. The composer remains active during streaming.

| Delivery mode | When it arrives                                                                              |
| ------------- | -------------------------------------------------------------------------------------------- |
| Steering      | After the current assistant turn finishes executing its tool calls, before the next LLM call |
| Follow-up     | After the agent completes all work (all tool calls finished)                                 |

Queued messages appear in the composer area. Press Escape to abort and restore queued messages to the editor. Alt+Up to retrieve queued messages back.

## Conversation Inspect

The agent can read other conversation transcripts using the `conversation_inspect` tool. This provides read-only access to message history, tool calls, and results across threads. See [Conversation Inspect](conversation-inspect.md).

## Auto Mode

When enabled, each visible assistant turn is followed by a hidden review turn. The review runs in the background and can perform follow-up work. See [Auto Mode](auto-mode.md).

## Keyboard Shortcuts

| Action                   | Shortcut       |
| ------------------------ | -------------- |
| New conversation         | `Cmd+N`        |
| Toggle sidebar           | `Cmd+\`        |
| Toggle workbench         | `Cmd+Option+\` |
| Submit message           | Enter          |
| New line in composer     | Shift+Enter    |
| Cancel agent response    | Escape         |
| Retrieve queued messages | Alt+Up         |

All shortcuts are configurable in Settings.

## Routes

| Route                | Page                  |
| -------------------- | --------------------- |
| `/conversations`     | Conversation list     |
| `/conversations/new` | New conversation      |
| `/conversations/:id` | Existing conversation |
