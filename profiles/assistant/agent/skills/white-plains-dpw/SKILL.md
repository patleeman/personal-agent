---
name: white-plains-dpw
description: Fetch White Plains DPW trash/recycling/brush/bulk collection schedule from ReCollect by address. Use when asked for White Plains sanitation pickup days or calendar.
---

# White Plains DPW Collection Schedule

Use the script in `scripts/` for deterministic schedule lookups.

## Script

```bash
./scripts/dpw-schedule.sh [options]
```

Defaults:
- Address: `43 Chadwick Road, White Plains, NY 10604`
- Date window: today through the next 14 days

## Common usage

```bash
# Default address + next 14 days
./scripts/dpw-schedule.sh

# 30-day window
./scripts/dpw-schedule.sh --days 30

# Explicit date range
./scripts/dpw-schedule.sh --after 2026-03-01 --before 2026-03-31

# Different address
./scripts/dpw-schedule.sh --address "255 Main St White Plains"

# JSON output for downstream processing
./scripts/dpw-schedule.sh --json
```

## Notes

- The City page embeds ReCollect; this skill calls ReCollect APIs directly.
- Address lookup is fuzzy and the script normalizes common formats (commas, NY, ZIP, road abbreviations).
- Output includes pickup items like Trash, Paper/Cardboard, Commingled Recycling, Bulk Pickup, and holiday-related entries when present.
