# Auto Mode

Auto mode adds a hidden review turn after each visible assistant turn. The review runs in the background and can perform follow-up work, self-correct, or continue the task — all without user interaction.

## How It Works

```
User sends prompt
       │
       ▼
Visible turn: agent responds, calls tools, produces output
       │
       ▼
Hidden review turn: agent examines output, updates context file
       │
       ├── agent calls auto_mode_control "continue"
       │      │
       │      ▼
       │   Continuation hidden turn: agent continues the task
       │      │
       │      ▼
       │   Another hidden review turn → loop until "stop"
       │
       ├── agent calls auto_mode_control "stop"
       │      │
       │      ▼
       │   Auto mode ends, waiting for user
       │
       └── agent does not call auto_mode_control
              │
              ▼
           Retry hidden review turn (up to 2 times)
              │
              ▼
           If still no tool call → auto mode stops
```

## Control Tool

Each hidden review turn must call the `auto_mode_control` tool exactly once:

| Action     | When to use                                                            |
| ---------- | ---------------------------------------------------------------------- |
| `continue` | Meaningful work remains — keep auto mode running for the next turn     |
| `stop`     | Task is complete, blocked, or needs user input. Include a short reason |

### Stop examples

```json
{ "action": "stop", "reason": "done" }
{ "action": "stop", "reason": "needs user input" }
{ "action": "stop", "reason": "blocked on failing tests" }
```

If the agent does not call the control tool, auto mode retries the review turn up to 2 times, then stops.

## Persistent Context File

Each auto-mode session has a persistent context file at:

```
<runtime-dir>/auto-context/<session-id>.md
```

The agent should read this file on each wakeup to orient itself and write to it after each action to persist state across turns. The harness does not parse or validate its content — structure it however works for the task.

## Use Cases

### Code review

After the agent generates code, the hidden turn runs tests or lints the output:

1. Visible turn: agent writes a function
2. Hidden review turn: agent runs `npm run lint` on the generated code
3. If lint fails, the continuation turn fixes issues
4. If lint passes, review turn calls `stop`

### Self-correction

The hidden turn checks the visible response for errors or missing details:

1. Visible turn: agent answers a question
2. Hidden review turn: agent reviews the answer for factual accuracy
3. If errors found, continuation turn corrects them
4. If accurate, review turn calls `stop`

### Multi-step tasks

Each step queues the next logical step:

1. Visible turn: agent completes step 1
2. Hidden review turn: agent verifies step 1, updates context file, calls `continue`
3. Continuation turn: agent executes step 2
4. Loop repeats until all steps are done

## Hidden Turn Detection

The hidden review turn and continuation turn have distinct custom types (`conversation_automation_post_turn_review` and `conversation_automation_auto_continue`). The agent can detect which type of turn it is in by inspecting the session context.

## Configuration

Auto mode is enabled per-conversation through the conversation settings. There is no global auto mode toggle.
