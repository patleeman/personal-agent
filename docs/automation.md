# Automation

`personal-agent` has three main automation surfaces.

Use the one that matches the scope and timing of the work:

- **conversation automation** for ordered skill steps inside one conversation
- **durable background runs** for detached work started now
- **scheduled tasks** for work that should run later or on a schedule

## Choose the right automation surface

| Need | Use | Scope | Trigger |
| --- | --- | --- | --- |
| Repeatable steps inside one live thread | conversation automation / todo list | one conversation | now, from the current thread |
| Detached work you want to start immediately | durable background run | one background job | now |
| Unattended work that should run later or repeatedly | scheduled task | daemon-managed durable automation | later / recurring |

A simple rule:

- **inside this conversation** → conversation automation
- **now, detached** → run
- **later or recurring** → scheduled task

## Conversation automation

Conversation automation is the lightweight workflow surface.

It is an ordered todo list of skill steps attached to one conversation.

Use it when you want:

- a reusable ordered workflow in a live thread
- automation presets that can be applied to a conversation
- structured skill execution that still belongs to this conversation's narrative

Do not use it when the work needs:

- a schedule
- detached execution outside the conversation
- long-running daemon ownership as its primary model

The conversation remains the durable narrative home. The automation list is conversation-local state.

## Durable background runs

A run is detached background work started on demand.

Use it when you want to:

- kick off shell work now and inspect it later
- launch a focused subagent now
- avoid blocking the current thread with long-running local work

Runs are daemon-backed and write durable records under the daemon state root.

Use a run instead of a scheduled task when the work should begin immediately and does not need a future schedule.

See [Runs](./runs.md).

## Scheduled tasks

A scheduled task is durable unattended automation defined in a `*.task.md` file.

Use it when something should happen:

- later
- on a recurring schedule
- without an active conversation open

Good fits:

- morning reports
- recurring reviews
- periodic checks
- background prompts that should surface activity later

See [Scheduled Tasks](./scheduled-tasks.md).

## Daemon relationship

Runs and scheduled tasks depend on the daemon for durable background ownership.

Conversation automation is conversation-local and does not require a future schedule, but it still lives inside the same product model and can create follow-on work such as reminders, runs, or scheduled tasks when needed.

If the daemon is off:

- scheduled tasks do not run
- detached runs are unavailable or degraded
- conversation automation can still exist, but it is not a substitute for daemon-backed automation

## Attention and reporting

Different automation surfaces report back differently.

- **conversation automation** reports inside the conversation
- **runs** report through run records, logs, and optional later surfacing
- **scheduled tasks** write logs and usually create activity; they can also callback into a conversation when explicitly configured that way

If the result belongs to a conversation, keep the durable outcome with the conversation and surface the conversation later instead of duplicating it everywhere.

## Common choices

### “Do this workflow in the current thread”

Use conversation automation.

### “Start this long-running check now and let me inspect status later”

Use a durable background run.

### “Every weekday at 9, generate a report”

Use a scheduled task.

### “Watch this later and bring this thread back when it matters”

Usually use a scheduled task or deferred resume, depending on whether you need actual unattended work or just a future continuation.

## Related docs

- [Decision Guide](./decision-guide.md)
- [Conversations](./conversations.md)
- [Runs](./runs.md)
- [Scheduled Tasks](./scheduled-tasks.md)
- [Daemon and Background Automation](./daemon.md)
