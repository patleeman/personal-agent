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
- Daily run note: `notes/daily/<YYYY-MM-DD>.md`
- Optional profile updates (skills, project docs, AGENTS) when warranted by conversation patterns.

## Processing Rules

1. Each run scans the **last 7 days** of conversations and selects unprocessed sessions.
2. Process sessions oldest-first (conversation-level, not day-level).
3. Keep AGENTS edits high-level and durable only.
4. Put reusable workflows in skills.
5. Put project-specific details in project workspace docs.
6. Upsert processed sessions into `notes/processed-conversations.json` by `sessionId`.
7. Log each run in `notes/processed-days.md` and include session/file details in the daily note.
