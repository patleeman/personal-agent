---
name: apple-calendar-local
description: Query local Apple Calendar (Calendar.app) via osascript for agenda/today/tomorrow views. Use when Patrick asks for agenda, calendar status, or morning-report calendar blocks.
---

# Apple Calendar (local via osascript)

Use this skill for Calendar.app reads on this Mac.

## Default scope (Patrick)

- `Patrick Lee` (personal)
- `patrickc.lee@datadoghq.com` (work)
- `Sanitation` (iCloud)

Avoid `Holidays`, `Birthdays`, and `Scheduled Reminders` unless explicitly requested.

## Script (preferred)

```bash
./scripts/apple-calendar-agenda.py --json
```

Common usage:

```bash
# Human-readable agenda (today + first tomorrow-AM event)
./scripts/apple-calendar-agenda.py

# JSON for downstream formatting
./scripts/apple-calendar-agenda.py --json

# Explicit calendar(s)
./scripts/apple-calendar-agenda.py --calendar "patrickc.lee@datadoghq.com" --calendar "Patrick Lee"

# Query every local calendar (except noisy system calendars)
./scripts/apple-calendar-agenda.py --all-calendars

# Include Holidays/Birthdays/Scheduled Reminders when using --all-calendars
./scripts/apple-calendar-agenda.py --all-calendars --include-noisy-calendars

# Discover local calendar names
./scripts/apple-calendar-agenda.py --list-calendars
```

## Required handling rules

- Query each calendar independently; do not let one slow account block the whole result.
- Keep per-calendar AppleScript calls timeout-bounded (~20–25s).
- Deduplicate exact duplicate rows from Calendar.app.
- Apply a second overlap filter in Python to suppress stale recurring-master rows.
- Treat all-day events as valid agenda events.

## AppleScript quirks (read before ad-hoc scripts)

See `references/quirks.md`.
