# Processed Conversation Runs (assistant)

Source of truth for per-session processing:
- `processed-conversations.json`

Run log format:
- `run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | changed=<yes|no>`

Entries:
- run=2026-03-08T16:15:38Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=32 | changed=yes
- run=2026-03-08T19:16:02Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=14 | changed=yes
- run=2026-03-08T22:14:30Z | window=2026-03-02..2026-03-08 | processed=16 | remaining=0 | changed=yes
