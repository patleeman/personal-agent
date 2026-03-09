# Conversation Maintenance

## Purpose

Run a rolling conversation retrospective and capture durable improvements for the `assistant` profile.

## Inputs

- Session files: `~/.local/state/personal-agent/pi-agent/sessions/**/*.jsonl`
- Unprocessed selector script:
  - `scripts/conversation-maintenance/list-unprocessed-sessions.mjs`
- Profile memory/policy files:
  - `profiles/assistant/agent/AGENTS.md`
  - `profiles/assistant/agent/skills/**`
  - `profiles/assistant/agent/workspace/projects/**`

## Outputs

- Structured processed index (source of truth): `notes/processed-conversations.json`
- Run log: `notes/processed-days.md`
- Optional profile updates (skills, project docs, AGENTS) when warranted by conversation patterns.

## Processing Rules

1. Each run scans the **last 7 days** of conversations and selects unprocessed sessions.
2. Treat the selector script JSON output as the source of truth for what is processed in that run.
3. If the selector reports `index.parseError`, stop and fix the index before making any edits.
4. Process sessions oldest-first (conversation-level, not day-level).
5. If more than 20 sessions are unprocessed, process the first 20 oldest and leave an explicit backlog count.
6. Keep AGENTS edits high-level and durable only.
7. Put reusable workflows in skills.
8. Put project-specific details in project workspace docs.
9. Upsert processed sessions into `notes/processed-conversations.json` by `sessionId`.
10. Log each run in `notes/processed-days.md`.
