# personal-agent internal skills

This folder holds the agent-facing internal skills for built-in `personal-agent` features.

These are built-in runtime guides, not user-authored workflow skills. Use them when the task is about how a personal-agent feature should behave, which built-in surface to use, or how to produce output that fits that feature well. Keep broader product, setup, and architecture docs in `docs/`.

## Start here

- [Artifacts and Rendered Outputs](./artifacts/INDEX.md)
- [Async Attention and Wakeups](./async-attention/INDEX.md)
- [Computer Use](./computer-use/INDEX.md)
- [Scheduled Tasks](./scheduled-tasks/INDEX.md)
- [Runs](./runs/INDEX.md)
- [Reminders and Notification Delivery](./alerts/INDEX.md)
- [Shared Inbox Removal](./inbox/INDEX.md)
- [Skills and Runtime Capabilities](./skills-and-capabilities/INDEX.md)

## How to use this folder

Each internal skill lives in its own directory with an `INDEX.md`, mirroring the shape of normal skills while staying a separate runtime category. Read the matching internal skill when the task touches a built-in `personal-agent` feature such as computer use, artifacts, tasks, runs, reminders, async attention, or runtime capabilities. Follow markdown cross-references within this folder first, then jump back to `docs/` for broader product context when needed.
