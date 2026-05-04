# Reminders

Reminders are tell-me-later wakeups that resume a conversation at a specified time. They are conversation-bound — each reminder is tied to the thread where it was created.

## Creating a Reminder

Use the `reminder` tool from within a conversation. Specify either a relative delay or an absolute time.

### By delay

```json
{
  "delay": "30s",
  "prompt": "Check if the build finished",
  "title": "Build check"
}
```

Supported delay units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

### By absolute time

```json
{
  "at": "tomorrow 8pm",
  "prompt": "Remind me to deploy the release",
  "title": "Release deploy"
}
```

Supports ISO timestamps (`2026-06-01T09:00:00Z`), natural language (`tomorrow 8pm`, `next monday 9am`), and explicit forms (`now+1d@20:00`).

## Parameters

| Parameter          | Required    | Description                                          |
| ------------------ | ----------- | ---------------------------------------------------- |
| `delay`            | conditional | Relative time until the reminder fires               |
| `at`               | conditional | Absolute time for the reminder to fire               |
| `prompt`           | yes         | What the agent should do when the reminder fires     |
| `title`            | no          | Short label shown in alerts                          |
| `notify`           | no          | Alert style: `"disruptive"` (default) or `"passive"` |
| `requireAck`       | no          | Whether the alert stays until acknowledged           |
| `autoResumeIfOpen` | no          | Auto-resume the conversation if already open         |

Exactly one of `delay` or `at` must be specified.

## Delivery

When a reminder fires:

1. The daemon wakes the conversation
2. The prompt is delivered to the agent as a user message
3. The agent processes the prompt and responds
4. An in-app alert is raised in the desktop app

## Alert Behavior

| `notify` value | Behavior                                                        |
| -------------- | --------------------------------------------------------------- |
| `"disruptive"` | Default. Raises an in-app notification that interrupts the user |
| `"passive"`    | Quiet notification that does not interrupt                      |

| `requireAck`      | Behavior                                                    |
| ----------------- | ----------------------------------------------------------- |
| `true`            | Alert stays active in the UI until the user acknowledges it |
| `false` (default) | Alert fires once and is dismissed                           |

| `autoResumeIfOpen` | Behavior                                                             |
| ------------------ | -------------------------------------------------------------------- |
| `true`             | If the target conversation is already open, it resumes automatically |
| `false` (default)  | The conversation is resumed in the background                        |

## Reminders vs Scheduled Tasks

|             | Reminders              | Scheduled Tasks                  |
| ----------- | ---------------------- | -------------------------------- |
| Scope       | Conversation-bound     | App-wide                         |
| Trigger     | Delay or absolute time | Cron or one-time                 |
| Target      | Always a conversation  | Background agent or conversation |
| Alert       | In-app notification    | Optional callback                |
| Persistence | Runtime state          | Automation store                 |

Use reminders when you want the agent to tell you something later. Use scheduled tasks when you want unattended work to happen on a schedule.

## Storage

Reminders are stored in the daemon's runtime database and survive daemon restarts. When a reminder fires while the daemon is offline, it fires on the next daemon startup.
