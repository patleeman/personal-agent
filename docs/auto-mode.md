# Auto Mode

Auto mode lets a conversation keep moving without the user manually prompting every next step. It works best when it has a visible, bounded **mission**: the current goal auto mode is allowed to pursue inside the conversation.

The mission is narrower than the whole thread. A conversation can be broadly about the iOS app while the current auto mission is specifically “rebase the iOS reliability commits onto `origin/master`, validate tests, and report blockers.”

Auto mode adds a hidden review turn after each visible assistant turn. The review runs in the background and decides whether to continue, stop, or report a blocker.

## Mission

Auto mode should be configured around a mission contract:

```ts
{
  enabled: true,
  mission: 'Fix iOS chat reconnect/resubscribe reliability and validate focused tests.',
  mode: 'normal' | 'tenacious' | 'forced',
  budget?: {
    maxTurns?: number,
    until?: string,
  },
  stopWhen: ['goal_complete', 'needs_user_input', 'external_blocker', 'budget_exhausted'],
}
```

### Deriving the mission

Auto mode can be enabled at any time, so the mission comes from the strongest available signal:

1. explicit slash-command text, for example `/auto tenacious until tests pass: fix reconnect bugs`
2. the current pending user request
3. recent conversation context and summaries

If confidence is low, auto mode should not start silently. Show an editable draft mission or ask the user for one. Hidden inferred goals make the UI feel spooky and brittle.

### Modes

| Mode        | Behavior                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `normal`    | Current default. Continue when meaningful work remains; stop when the mission appears satisfied or blocked                              |
| `tenacious` | Continue unless there is a concrete terminal reason: complete, needs user input, external blocker, or scope-changing validation failure |
| `forced`    | Continue until the mission is complete, a hard blocker appears, or an explicit turn/time budget is exhausted                            |

Forced mode should always have a budget. Infinite loops are a footgun; scoped forced loops are the pressure relief valve for when the model is stopping too early.

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

The hidden review should judge against the active mission. “I made progress” is not enough to stop. In tenacious or forced mode, stop reasons should be concrete and terminal.

Preferred stop shape:

```json
{
  "action": "stop",
  "reason": "Focused reconnect regressions pass; full suite only has unrelated existing failures.",
  "stopCategory": "complete",
  "confidence": 0.9
}
```

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
