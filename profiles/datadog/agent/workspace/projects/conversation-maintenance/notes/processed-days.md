# Processed Conversation Runs (datadog)

Source of truth for per-session processing:
- `processed-conversations.json`

Run log format:
- `run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | changed=<yes|no>`

Entries:
- run=2026-03-08T16:44:47Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=33 | changed=yes
- run=2026-03-08T19:44:31Z | window=2026-03-02..2026-03-08 | processed=20 | remaining=15 | changed=yes
- run=2026-03-08T22:45:45Z | window=2026-03-02..2026-03-08 | processed=17 | remaining=0 | changed=yes
