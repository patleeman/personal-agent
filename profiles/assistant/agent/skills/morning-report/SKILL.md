---
name: morning-report
description: Build Patrick's morning report / daily brief for Telegram or Discord. Use when asked for a morning report, daily brief, or agenda+weather+reminders summary, or when maintaining the assistant morning-report workflow.
---

# Morning Report

Build a concise, mobile-first morning brief for Patrick in `America/New_York` using fresh runtime data on every run.

## Default contents

1. Weather
2. Calendar
3. Reminders

Goal: a short, glanceable, high-signal update that fits naturally in Telegram or Discord.

Default output shape:
- `# ☀️ Morning Report`
- weather, calendar, reminders in that order
- no extra `Quick Take` section
- no `Morning report complete.` footer
- target `<= 120` words unless critical items require slightly more

## Weather

- Prefer free weather sources.
- First try `wttr.in` with a hard timeout (for example `curl --max-time 15 ...`).
- If `wttr.in` times out or returns unusable output, fall back to Open-Meteo for White Plains (`latitude=41.033`, `longitude=-73.7629`, `timezone=America/New_York`).
- Gather enough detail to summarize:
  - current temperature, feels-like / wind chill when available, wind, humidity, condition
  - today high/low and precipitation outlook
  - tomorrow high/low and precipitation outlook when useful for planning
- Render the weather section as **one sentence**: current conditions + today high/low + a practical note.
- Do not mention the source unless something is unavailable.

## Calendar

- Prefer local calendar reads. Load and use `apple-calendar-local`.
- For the morning report, use **only** these local Apple calendars unless Patrick explicitly asks otherwise:
  - `Patrick Lee`
  - `patrickc.lee@datadoghq.com`
  - `Sanitation`
- Do **not** use Fastmail/CalDAV for the standard morning report.
- Query each target calendar independently with bounded AppleScript timeouts (~20–25s).
- Use narrow windows:
  - now → end of today
  - start of tomorrow → end of tomorrow
- If a calendar query times out, warm up Calendar.app with `osascript -e 'tell application "Calendar" to launch'` and retry that calendar once before marking it unavailable.
- Include today and tomorrow events with time, title, and calendar name. Add an `Upcoming` line only for clearly notable items later in the next week.
- If local calendar access is unavailable or times out, report it as `Unavailable: <exact reason>`.

## Reminders

- Read Apple Reminders via `osascript` with bounded timeouts.
- Group reminders as:
  - overdue + due today
  - due tomorrow
  - only truly important upcoming reminders in the next 7 days
- Keep Reminders AppleScript timeout around 25–30s per attempt.
- If the first Reminders query times out, warm up Reminders with `osascript -e 'tell application "Reminders" to launch'` and retry once before reporting unavailable.
- For each item include due date/time when present, list name, and title.
- If Reminders access fails or times out, report it as `Unavailable: <exact reason>`.

## Runtime rules

- Gather fresh data at runtime.
- Use `America/New_York` for all displayed times.
- Bound network and 1Password-related calls; fail fast instead of hanging (roughly 30s max per call path).
- If any source is unavailable, report it as `Unavailable: <exact reason>`.
- Do not guess missing calendar, reminder, or weather data.
- Prefer concise, actionable bullets over long prose.
- Avoid duplicate summary blocks; one weather sentence is enough.
- Follow stricter user-supplied formatting when present.
