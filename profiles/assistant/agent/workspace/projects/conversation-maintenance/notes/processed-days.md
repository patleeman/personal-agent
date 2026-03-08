# Processed Conversation Runs (assistant)

Source of truth for per-session processing:
- `processed-conversations.json`

Run log format:
- `run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | note=<relative-note-path>`

Entries:
- run=2026-03-08T16:15:38Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=32 | note=notes/daily/2026-03-08.md
- run=2026-03-08T19:16:02Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=14 | note=notes/daily/2026-03-08.md
