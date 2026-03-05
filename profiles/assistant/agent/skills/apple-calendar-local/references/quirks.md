# Apple Calendar / AppleScript Idiosyncrasies

These are the concrete pitfalls observed while querying local Calendar.app.

## 1) Date alias mutation (critical)

If you do:

- `set endDate to nowDate`
- then mutate `endDate` (e.g., set hours/minutes/seconds)

AppleScript can mutate the same underlying date object, so `nowDate` changes too.

### Symptom

Timed events earlier in the day disappear; you only see all-day/late events.

### Fix

Clone before mutation:

- `set endDate to nowDate + 0`

Use this pattern for every derived date (`todayEnd`, `tomorrowNoon`, etc.).

## 2) Recurring-master leakage

`every event ... whose start date/end date ...` may return recurring master rows with old start/end dates.

### Symptom

Very old events (e.g., from weeks ago) appear in “today” queries.

### Fix

Use two filters:
1. AppleScript query filter (coarse)
2. Post-filter in Python by true overlap with the target window (`end >= window_start` and `start <= window_end`)

Then dedupe exact duplicates.

## 3) Duplicate rows

Calendar.app queries can emit exact duplicates (same title/start/end/all-day).

### Fix

Deduplicate by:
- calendar
- start
- end
- all_day
- title

## 4) Calendar names must match exactly

Names are account-scoped and case-sensitive enough to fail in practice.

### Fix

List names first with `--list-calendars`, then query exact strings.

## 5) Time window handling

For morning-report style agenda:
- Window A: `now -> today 23:59:59`
- Window B: `tomorrow 00:00:00 -> tomorrow 12:00:00`

Use narrow windows to reduce noise and latency.

## 6) Keep per-calendar timeouts

One calendar/account can stall.

### Fix

Run per calendar with timeout; report partial results with `Unavailable: <calendar>: <reason>`.

## 7) Ignore noisy system calendars by default

Unless requested, exclude:
- Holidays (`Holidays in United States`, `US Holidays`)
- `Birthdays`
- `Scheduled Reminders`

These can dominate short agenda summaries.
