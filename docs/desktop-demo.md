# Desktop demo environment

Use the desktop demo environment when you need a stable UI workspace with seeded conversations, automations, runs, and assets.

## Command

```bash
npm run desktop:demo
```

That command:

- creates an isolated temporary state root
- seeds curated desktop conversations
- seeds automations visible in the Automations UI
- seeds durable runs visible in the Runs UI
- seeds conversation artifacts, checkpoints, and an attachment
- launches the desktop app against that isolated demo state

## Seeded content

Conversations:

- `demo-empty` — brand new conversation state
- `demo-normal` — normal completed exchange
- `demo-tools` — tool-use transcript
- `demo-running` — in-progress style conversation state
- `demo-rich` — conversation with artifact, checkpoint, and attachment
- `demo-reminder` — scheduled reminder and ready callback state
- `demo-auto-review` — hidden auto-review work rendered in transcript
- `demo-parent` / `demo-subagent-child` — subagent lineage demo
- `demo-parallel-parent` — persisted parallel prompt jobs
- `demo-attention` — unread attention and linked activity state
- `demo-remote` — remote-host-linked conversation metadata
- `demo-related-context` — reused related-thread summary injection

Automations:

- `demo-daily-summary`
- `demo-follow-up-thread`
- `demo-failed-automation`

Runs:

- `run-demo-review` — waiting / attention style run
- `run-demo-tests` — completed run
- `run-demo-failed` — failed scheduled-task run

Deferred resumes:

- `resume-demo-reminder` — scheduled reminder
- `resume-demo-callback` — ready task callback

Pathological fixtures:

- `desktop/daemon-offline-demo.json` — sample daemon offline snapshot
- remote conversation metadata on `demo-remote`
- related context summary transcript shape on `demo-related-context`

## Implementation

Seed generation lives in:

- `scripts/desktop-demo.mjs`
- `packages/desktop/scripts/launch-demo-app.mjs`

The launcher prints the temporary demo state root and env file so you can relaunch manually if needed.
