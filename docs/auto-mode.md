# Auto Mode and Run Modes

Auto mode is conversation-scoped background continuation. The composer exposes it as a run-mode selector with four states: Manual, Nudge, Mission, and Loop.

## Modes

| Mode    | Behavior                                                                                                                 | Stop condition                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Manual  | No automatic continuation.                                                                                               | User sends the next prompt.                                                                        |
| Nudge   | Legacy soft auto mode. A hidden review turn decides whether useful work remains.                                         | The review calls stop, misses the control tool too many times, or the user stops the conversation. |
| Mission | Goal-driven mode with an AI-managed task list. The agent must keep updating `run_state` and continue while tasks remain. | All mission tasks are `done`, max turns is reached, or the user stops the conversation.            |
| Loop    | Fixed-count mode. The same loop prompt is continued until the iteration counter reaches N.                               | Iterations used reaches max iterations, or the user stops the conversation.                        |

Manual, Mission, and Loop are selected from the run-mode control in the composer. Mission and Loop show their setup/status panel above the input area only while active.

## Nudge Flow

```
Visible assistant turn
       │
       ▼
Hidden review turn
       │
       ├── conversation_auto_control { action: "continue" }
       │      └── hidden continuation turn, then another review
       │
       ├── conversation_auto_control { action: "stop" }
       │      └── auto mode ends
       │
       └── no tool call
              └── retry review up to 2 times, then stop
```

Nudge mode is intentionally soft. It is best for “keep an eye on yourself” work like linting, small self-corrections, or continuing when the next step is obvious.

## Mission Flow

Mission mode stores a mission state containing a goal, tasks, turn count, and max turns. The model sees the `run_state` tool only while Mission or Loop is active.

On each mission turn, the agent should:

1. Call `run_state { action: "get" }`.
2. Create the initial task list if the list is empty.
3. Work the next incomplete task.
4. Call `run_state { action: "update_tasks" }` to add tasks or mark status changes.

Mission continuation is structural: the harness keeps scheduling hidden continuation turns while at least one task is not `done`. An empty task list is not complete; it forces the model to bootstrap tasks instead of silently ending.

## Loop Flow

Loop mode stores a prompt, max iteration count, iterations used, and delay. After each loop turn, the harness increments the counter and schedules the next hidden continuation until the counter reaches the configured max.

Simple delays are supported in the loop delay field: `immediate`, `After each turn`, `500ms`, `2s`, `5m`, or `1h`. Unknown delay text falls back to immediate continuation.

## Tools

### `conversation_auto_control`

Visible only during Nudge hidden review turns.

```json
{ "action": "continue" }
{ "action": "stop", "reason": "done" }
```

### `run_state`

Visible only during Mission or Loop.

```json
{ "action": "get" }
{
  "action": "update_tasks",
  "tasks": [
    { "description": "Run tests", "status": "pending" },
    { "id": "task-id", "status": "done" }
  ]
}
```

`update_tasks` is mission-only. It can add new tasks or update existing task status/description.

## UI Contract

- The run-mode selector replaces the old auto toggle and stays in the composer preferences area.
- Mission and Loop render as a slim planning shelf above the composer, separate from the message input shell.
- The shelf uses one shared visual language: compact status header, borderless/underlined fields, and plain list rows.
- Mission task lists have a capped height and scroll.
- Loop keeps prompt, count, and delay editable while active in a single compact control line.
- There is no separate pause or abort affordance; the normal conversation stop button is the escape hatch.
