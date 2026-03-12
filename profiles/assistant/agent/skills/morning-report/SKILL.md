---
name: morning-report
description: Build Patrick's morning report / daily brief for Telegram or daemon-task delivery. Use when asked for a morning report, daily brief, or agenda+weather+reminders summary, or when maintaining the assistant morning-report workflow.
---

# Morning Report

Build a short, glanceable morning brief for Patrick in `America/New_York`.

## Default structure

Unless Patrick asks otherwise, format the report as:

```md
# ☀️ Morning Report
*White Plains, NY · <generated local time>*

## ━━ 🌤️ WEATHER ━━
<one sentence only>

## ━━ 📅 CALENDAR ━━
- **Today:** ...
- **Tomorrow:** ...
- **Upcoming:** ...    # optional, only when notable

## ━━ ✅ REMINDERS ━━
- **Today:** ...
- **Important next:** ...    # optional, only when notable
```

Keep total output tight (target about 120 words unless critical items justify slightly more).
Do not add a closing line like `Morning report complete.`

## Weather

- Prefer free weather sources.
- First try `wttr.in` with a hard timeout (for example `curl --max-time 15 ...`).
- If `wttr.in` times out or returns unusable output, fall back to Open-Meteo for White Plains (`latitude=41.033`, `longitude=-73.7629`, `timezone=America/New_York`).
- The weather block should be one sentence that covers:
  - current temperature and feels-like / wind chill when useful
  - today's high/low
  - precipitation outlook or the single most practical weather note
- Mention the weather source only when a fallback was required or weather is unavailable.

## Calendar

- Prefer local calendar reads. Load and use `apple-calendar-local`.
- For the default morning report, use only Apple Calendar / local Calendar.app data. Do not use Fastmail/CalDAV.
- Default calendars:
  - `Patrick Lee`
  - `patrickc.lee@datadoghq.com`
  - `Sanitation`
- Query calendars independently with bounded calls so one slow calendar does not block the rest.
- If a calendar query times out, warm up Calendar.app (`osascript -e 'tell application "Calendar" to launch'`) and retry that calendar once before reporting it unavailable.
- Scope the report to:
  - events from now through end of today
  - tomorrow-morning events before 12:00 PM, if present
  - later-week items only when they are clearly notable enough for a short `Upcoming` line
- If calendar access is unavailable or times out, report it as `Unavailable: <exact reason>`.

## Reminders

- Read Apple Reminders via `osascript` with bounded timeouts.
- Focus on:
  - overdue reminders
  - reminders due today
  - only truly important upcoming reminders in the next 7 days
- If the first Reminders query times out, warm up Reminders.app (`osascript -e 'tell application "Reminders" to launch'`) and retry once before reporting it unavailable.
- Keep the reminders section compact: usually no more than about 5 `Today` items and 3 `Important next` items.
- If Reminders access fails or times out, report it as `Unavailable: <exact reason>`.

## Runtime rules

- Gather fresh data at runtime.
- Bound network and `op`-related calls; fail fast instead of hanging.
- Use `America/New_York` for all times.
- Do not guess missing calendar, reminder, or weather data.
- Prefer concise, actionable bullets over long prose.
- Avoid source notes or duplicate explanation blocks unless something is unavailable or a fallback was required.
