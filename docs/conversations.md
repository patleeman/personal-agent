# Conversations

Conversations are live agent threads. Each conversation has a transcript, a composer, access to tools, and full message history.

## Starting a Conversation

Create a new conversation from the sidebar (`+` button) or navigate to `/conversations/new`. The composer appears at the bottom of the transcript pane.

Type a message and press Enter to send it to the agent. The agent processes the prompt, calls tools as needed, and streams the response.

## Composer

The composer is the text input area at the bottom of the conversation view. Image attachments are read into the draft as soon as they are added, so temporary screenshots can still be sent after their original files are cleaned up.

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

When the run mode has a pending continuation (Nudge/Mission/Loop), normal submits become follow-ups. Holding Command/Ctrl still starts a parallel side conversation.

Queued steer and follow-up prompts appear in the queue shelf above the composer. Use `restore` to pull a queued prompt back into the composer. Press Escape to abort the active response and restore queued messages to the editor. Press Alt+Up to retrieve queued messages back.

Parallel prompts appear in the Parallel shelf. A running parallel prompt can be cancelled. A completed or failed parallel prompt can be imported into the main thread, skipped, or opened as its own conversation.

Deferred resumes (`/resume`, `/defer`) also appear in the activity shelf above the composer. They are tied to the saved conversation and can be fired now, cancelled, or auto-resumed when the thread is reopened.

Interrupted prompts are not replayed automatically after an app restart. Durable run state is used for status and explicit recovery surfaces only; startup recovery must not silently resend the last prompt.

## Run Mode / Auto Mode

The composer exposes a run-mode selector with four states:

| Mode    | Behavior                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| Manual  | No automatic continuation.                                                           |
| Nudge   | Hidden review turn decides whether useful work remains.                              |
| Mission | Goal-driven mode with an AI-managed task list via the `run_state` tool.              |
| Loop    | Fixed-count mode. The same prompt is repeated until the iteration counter reaches N. |

See [Auto Mode](../extensions/system-auto-mode/README.md) for the full nudge, mission, and loop flows.

### Goal Mode (legacy)

The `set_goal` / `update_goal` tools provide a legacy goal-mode path. Continuations are scheduled only after `agent_end`, and repeated `update_goal { status: "complete" }` calls are idempotent. This is separate from the run-mode selector; only one loop controller can drive a conversation at a time.

## Slash Commands

Type `/` in the composer to open the command menu. Commands execute immediately — they don't get sent to the agent. Some trigger UI actions, others inject text into the composer.

| Command              | Action                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/compact`           | Manually compact session context (optionally pass guidance)                           |
| `/export [path]`     | Export session to HTML file                                                           |
| `/name <title>`      | Set session display name                                                              |
| `/run <cmd>`         | Send "Run this shell command: …" to the agent                                         |
| `/search <query>`    | Send "Search the web for: …" to the agent                                             |
| `/summarize`         | Send "Summarize our conversation so far" to the agent                                 |
| `/think [topic]`     | Send "Think step-by-step about: …" to the agent                                       |
| `/copy`              | Copy the last agent message to clipboard                                              |
| `/resume` / `/defer` | Schedule this conversation to continue later (usage: `/resume 10m continue checking`) |
| `/skill:<name>`      | Trigger a skill by name                                                               |

Several of these send a prompt to the agent instead of executing locally: `/run`, `/search`, `/summarize`, `/think`.

Commands accessible through dedicated desktop UI rather than the `/` menu include: `/model` (model picker in composer preferences row), `/fork` (message action menu), `/new` (sidebar + button), `/reload` (Extension Manager), `/clear` (Escape to cancel), `/image` (attachment button), `/draw` (composer input tool), `/session` (info display).

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

## Keyboard Shortcuts

| Action                   | Shortcut              |
| ------------------------ | --------------------- |
| New conversation         | `Cmd+N`               |
| Conversation mode        | `F1`                  |
| Workbench mode           | `F2`                  |
| Toggle sidebar           | `Cmd+/` (or `Ctrl+/`) |
| Toggle right rail        | `Cmd+\` (or `Ctrl+\`) |
| Submit message           | Enter                 |
| New line in composer     | Shift+Enter           |
| Cancel agent response    | Escape                |
| Retrieve queued messages | Alt+Up                |

Default shortcuts are configurable in Settings → Keyboard.

## Routes

The desktop app and system extensions register these routes:

| Route                | Page                  |
| -------------------- | --------------------- |
| `/conversations`     | Conversation list     |
| `/conversations/new` | New conversation      |
| `/conversations/:id` | Existing conversation |
| `/settings`          | Settings page         |
| `/knowledge`         | Knowledge browser     |
| `/automations`       | Scheduled task list   |
| `/automations/:id`   | Automation detail     |
| `/extensions`        | Extension Manager     |
| `/telemetry`         | Telemetry traces      |
| `/gateways`          | Gateway connections   |
