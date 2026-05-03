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
Hidden turn: agent reviews the output, can call more tools
       │
       ▼
If agent calls auto_mode_control "continue":
       │
       ▼
       Another hidden turn runs

If agent calls auto_mode_control "stop":
       │
       ▼
       Auto mode ends, waiting for user
```

The hidden turn is invisible in the transcript. It does not appear as a visible message. Its tool calls and results are recorded but not displayed.

## Control Tool

The agent controls auto mode through the `auto_mode_control` tool:

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

### Wrong usage

- Calling `continue` when the task is already complete — this loops forever
- Calling `stop` without a reason — the user sees no context about why it stopped

## Use Cases

### Code review

After the agent generates code, the hidden turn runs tests or lints the output:

1. Visible turn: agent writes a function
2. Hidden turn: agent runs `npm run lint` on the generated code
3. If lint fails, the hidden turn fixes issues and continues
4. If lint passes, the hidden turn stops

### Self-correction

The hidden turn checks the visible response for errors or missing details:

1. Visible turn: agent answers a question
2. Hidden turn: agent reviews the answer for factual accuracy
3. If errors found, the hidden turn corrects them and continues
4. If accurate, the hidden turn stops

### Multi-step tasks

The hidden turn queues the next logical step:

1. Visible turn: agent completes step 1 of a migration
2. Hidden turn: agent verifies step 1, then queues step 2 via `continue`
3. Step 2 runs as a new hidden turn
4. This continues until all steps are done

## Auto Mode vs Manual Follow-Up

|                 | Auto mode                           | Manual follow-up               |
| --------------- | ----------------------------------- | ------------------------------ |
| Trigger         | Automatic after each turn           | User queues a message          |
| Turn type       | Hidden                              | Visible                        |
| Agent awareness | Agent knows it's in auto mode       | Agent sees normal user message |
| Control         | Agent uses `auto_mode_control` tool | User controls timing           |

## Hidden Turn Detection

The agent can detect whether it is in a hidden review turn by checking the session context. The hidden turn has a distinct custom type (`auto-mode-hidden-review`) that extensions and the agent can identify.

## Configuration

Auto mode is enabled per-conversation. There is no global auto mode toggle. The agent enables it when appropriate for the task.
