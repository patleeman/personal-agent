# Conversations

Conversations are live agent threads. Each conversation has a transcript, a composer, access to tools, and full message history.

## Starting a Conversation

Create a new conversation from the sidebar (`+` button) or navigate to `/conversations/new`. The composer appears at the bottom of the transcript pane.

Type a message and press Enter to send it to the agent. The agent processes the prompt, calls tools as needed, and streams the response.

## Composer

The composer is the text input area at the bottom of the conversation view.

| Feature            | How                                                           |
| ------------------ | ------------------------------------------------------------- |
| Send message       | Enter                                                         |
| New line           | Shift+Enter                                                   |
| File / note / task | Type `@` to fuzzy-search files, notes, automations, or skills |
| Slash commands     | Type `/` to open the command menu                             |
| Run bash command   | Type `!<command>` to run a shell command inline               |
| Image paste        | Ctrl+V or drag image into composer                            |
| Binary attachment  | Drag file into composer                                       |
| Reply quoting      | Select text in a message, then click "Reply" to quote it      |
| Clear composer     | Ctrl+C when composer is focused                               |
| Recall history     | ↑/↓ cycles through recent prompts                             |

## Session Lifecycle

Conversations are saved automatically. Every message, tool call, and tool result is persisted. Past conversations appear in the left sidebar. Click any conversation to resume it.

| State      | Behavior                              |
| ---------- | ------------------------------------- |
| Active     | Agent is processing a prompt          |
| Compacting | Context is being summarized/trimmed   |
| Idle       | Waiting for user input                |
| Saved      | Persisted to disk, visible in sidebar |

Live conversations emit explicit `compaction_start` and `compaction_end` stream events. The desktop reducer uses them to show and clear the compaction state, while successful compactions also surface as compaction summary blocks in the transcript.

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

## Send Modifiers

The send button changes behavior based on streaming state and modifier keys. You can also hold a modifier when pressing Enter.

| Modifier                 | While idle                          | While streaming                     |
| ------------------------ | ----------------------------------- | ----------------------------------- |
| Enter (no modifier)      | Send message                        | Steer (interrupts current turn)     |
| **Alt+Enter**            | Follow-up (queues after completion) | Follow-up (queues after completion) |
| **Ctrl+Enter / ⌘+Enter** | Parallel (runs alongside)           | Parallel (runs alongside)           |

The button label reflects the current mode: **Send** → **Steer** → **Follow up** → **Parallel**.

## Async Follow-Through

While the agent is processing, you can queue additional messages. The composer remains active during streaming.

| Mode      | How to send                                                    | What happens                                                                                                                                          |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steer     | Press Enter while the agent is streaming                       | Queues guidance for the current turn. It is injected after the current assistant turn finishes its tool calls, before the next LLM call.              |
| Follow-up | Hold Option/Alt and press Enter while the agent is streaming   | Queues a new prompt after the agent completes all current work. Use this when the next instruction should not interrupt the current chain of thought. |
| Parallel  | Hold Command/Ctrl and press Enter while the agent is streaming | Starts a side conversation from the current context. The result can be imported back into the main thread, skipped, cancelled, or opened separately.  |

When auto mode has a hidden turn pending, normal submits become follow-ups. Holding Command/Ctrl still starts a parallel side conversation.

Queued steer and follow-up prompts appear in the queue shelf above the composer. Use `restore` to pull a queued prompt back into the composer. Press Escape to abort the active response and restore queued messages to the editor. Press Alt+Up to retrieve queued messages back.

Parallel prompts appear in the Parallel shelf. A running parallel prompt can be cancelled. A completed or failed parallel prompt can be imported into the main thread, skipped, or opened as its own conversation.

Deferred resumes (`/resume`, `/defer`) also appear in the activity shelf above the composer. They are tied to the saved conversation and can be fired now, cancelled, or auto-resumed when the thread is reopened.

## Goal Mode

Goal mode stores one active objective on the conversation and can queue hidden continuation turns until that objective is done. The continuation prompt tells the agent to call `update_goal` when the objective is achieved. If two continuation turns make no tool-driven progress, goal mode pauses the objective with a `no progress` stop reason instead of spinning forever. Clearing the goal removes the active objective; blank or whitespace-only goal updates are treated as clears instead of creating an empty active goal.

Legacy conversation auto-mode state (`nudge`, `mission`, and `loop`) remains readable for older session files and compatibility APIs, but it no longer schedules hidden continuation turns. Autonomous continuation is owned by the goal-mode extension state (`conversation-goal`) so only one loop controller can drive a conversation.

## Slash Commands

Type `/` in the composer to open the command menu. Commands execute immediately — they don't get sent to the agent. Some trigger UI actions, others inject text into the composer.

| Command              | Action                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/model`             | Open model selector                                                                   |
| `/compact`           | Manually compact session context (optionally pass guidance)                           |
| `/export`            | Export session to HTML file                                                           |
| `/name`              | Set session display name                                                              |
| `/session`           | Show session info and stats                                                           |
| `/fork`              | Fork a new conversation from a previous message                                       |
| `/summarize-fork`    | Duplicate + compact thread into a new conversation                                    |
| `/new`               | Start a new conversation                                                              |
| `/reload`            | Reload extensions, skills, prompts, and themes                                        |
| `/page`              | Create or reference a page for this conversation                                      |
| `/draw`              | Create an Excalidraw drawing attachment                                               |
| `/drawings`          | Attach an existing saved drawing                                                      |
| `/resume` / `/defer` | Schedule this conversation to continue later (usage: `/resume 10m continue checking`) |
| `/clear`             | Clear the composer                                                                    |
| `/image`             | Open file picker to attach an image                                                   |
| `/copy`              | Copy the last agent message to clipboard                                              |
| `/skill:<name>`      | Trigger a skill by name                                                               |

The following commands send a prompt to the agent instead of executing directly:

| Command           | Sends                                              |
| ----------------- | -------------------------------------------------- |
| `/run <cmd>`      | "Run this shell command and show me the output: …" |
| `/search <query>` | "Search the web for: …"                            |
| `/summarize`      | "Summarize our conversation so far concisely."     |
| `/think [topic]`  | "Think step-by-step about: …"                      |

## Bash Commands

The composer supports inline bash execution. The entire input line must start with `!` or `!!`.

| Syntax        | Behavior                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------- |
| `!<command>`  | Runs the shell command. Output streams into the conversation.                             |
| `!!<command>` | Same, but excludes the command and output from the agent's context (reduces token usage). |

Examples:

```
!git status
!!npm test
```

Bash commands create or reuse a live session in the conversation's working directory.

These direct `!` / `!!` commands render as terminal-style transcript output. Regular agent-selected `bash` tool calls stay grouped with the rest of the agent's internal work, and expanding that cluster shows the normal tool disclosure card for the bash step.

## Mention Menu

Type `@` in the composer to search and reference items. The menu surfaces:

- **Files** — workspace files by path
- **Notes** — memory documents by title
- **Tasks** — named automations by ID
- **Skills** — registered skills

Select an item to insert its reference (`@<id>`). The referenced content is injected into the agent's context when the message is sent.

## Reply Quoting

Select any portion of text in a conversation message. A **Reply** action appears that quotes the selection into the composer as a blockquote, making it easy to reference or respond to specific parts of a response.

## Conversation Inspect

The agent can read other conversation transcripts using the `conversation_inspect` tool. This provides read-only access to message history, tool calls, and results across threads. Live and running scopes include other currently active conversations, not just persisted session files. See [Conversation Inspect](../extensions/system-conversation-tools/README.md).

## Auto Mode

When enabled, each visible assistant turn is followed by a hidden review turn. The review runs in the background and can perform follow-up work. See [Auto Mode](../extensions/system-auto-mode/README.md).

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
