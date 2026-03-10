---
name: morning-report
description: Build Patrick's morning report / daily brief for Telegram or daemon-task delivery. Use when asked for a morning report, daily brief, or agenda+weather+reminders summary, or when maintaining the assistant morning-report workflow.
---

# Morning Report

Build a concise, mobile-first morning brief for Patrick in `America/New_York`.

## Default contents

1. Weather
2. Calendar
3. Reminders

Keep sections short and finish with `Morning report complete.`

## Weather

- Prefer free weather sources.
- First try `wttr.in` with a hard timeout (for example `curl --max-time 15 ...`).
- If `wttr.in` times out or returns unusable output, fall back to Open-Meteo for White Plains (`latitude=41.033`, `longitude=-73.7629`, `timezone=America/New_York`).
- Include:
  - current temperature, feels-like / wind chill when available, wind, humidity, condition
  - today high/low, precipitation chance, concise forecast
  - tomorrow high/low, precipitation chance, concise forecast
- Briefly name the source used, especially when a fallback was required.

## Calendar

- Prefer local calendar reads. Load and use `apple-calendar-local`.
- Scope the report to:
  - events from now through end of today
  - the first tomorrow event before 12:00 PM, if present
- Use Patrick's normal local calendars and avoid noisy system calendars unless explicitly requested.
- If local calendar access is unavailable or times out, report it as unavailable with the exact reason.
- Use Fastmail calendar access only when Patrick explicitly asks for Fastmail or local reads are not appropriate.

## Reminders

- Read Apple Reminders via `osascript` with bounded timeouts.
- Include:
  - overdue reminders
  - reminders due in the next 7 days
- For each item include due date/time when present, list name, and title.
- If Reminders access fails or times out, report it as unavailable with the exact reason.

## Runtime rules

- Gather fresh data at runtime.
- Bound network and 1Password-related calls; fail fast instead of hanging.
- Do not guess missing calendar or reminder data.
- Prefer concise, actionable bullets over long prose.
