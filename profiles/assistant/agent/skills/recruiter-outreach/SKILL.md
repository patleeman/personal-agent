---
name: recruiter-outreach
description: Scan Fastmail for recruiter-like outreach and update the recruiter-outreach JSONL store. Use when Patrick asks to check recruiter emails, recruiter outreach, or update the recruiter workspace list.
---

# Recruiter Outreach Sync

Use the repo task script for recruiter-outreach scans. Do not use stale `agent-workspace` script paths.

## Preferred command

From the repo root (`/Users/patrick/workingdir/personal-agent`), run:

```bash
FASTMAIL_SECRET_RESOLVER="sdk-only" \
FASTMAIL_API_KEY_OP_REF="op://Assistant/FASTMAIL_API_KEY/password" \
FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_API_KEY/password" \
FASTMAIL_USERNAME="me@patricklee.nyc" \
profiles/assistant/agent/tasks/scripts/recruiter-outreach.sh
```

Optional flags:

- `--days N` for a trailing N-day scan instead of the previous local day
- `--bootstrap` to rebuild the JSONL store from the current scan window

## Behavior

- Default window: the previous local calendar day in `America/New_York`.
- The script appends new recruiter-like messages to `~/.local/state/personal-agent/recruiter-outreach/recruiter_outreach.jsonl`.
- The script prints a compact sync summary with counts and up to 15 new records.
- Secret resolution is already built into the script; prefer the Fastmail env vars shown above.

## Reporting

Keep the reply concise and include:

- whether new records were added
- likely company/recruiter highlights from new rows
- the exact failure reason if the script errors

## Guardrails

- Do not hand-edit the JSONL store unless Patrick explicitly asks.
- If a prompt references `/Users/patrick/agent-workspace/recruiter-outreach/scripts/recruiter-outreach.sh`, use the repo task script instead.
- If secret resolution or IMAP fails, surface the exact error instead of masking it with a generic retry summary.
