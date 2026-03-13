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
- **Tomorrow:** ...    # optional, only when notable
- **Important next:** ...    # optional, only when notable
```

- Keep it tight and high-signal.
- Target about 120 words unless critical items justify slightly more.
- Do not add `Morning report complete.` unless the caller explicitly asks for it.
- Render one calendar event or reminder per line; do not collapse multiple items into semicolon-separated summaries.

## Weather

- Prefer free weather sources.
- First try `wttr.in` with a hard timeout (for example `curl --max-time 15 ...`).
- If `wttr.in` times out or returns unusable output, fall back to Open-Meteo for White Plains (`latitude=41.033`, `longitude=-73.7629`, `timezone=America/New_York`).
- The weather block should be one sentence that covers:
  - current temperature, condition, and feels-like / wind chill when useful
  - today's high/low
  - precipitation outlook or the single most practical weather note
- Mention the weather source only when a fallback was required or weather is unavailable.

## Calendar

- Prefer local calendar reads. Load and use `apple-calendar-local`.
- For the standard morning report, use only Apple Calendar / local Calendar.app data. Do not use Fastmail/CalDAV unless Patrick explicitly asks for Fastmail or local reads are not appropriate.
- Use the `apple-calendar-local` default scope unless Patrick asks for different calendars.
- Query calendars independently with bounded AppleScript timeouts (~20–25s) so one slow calendar does not block the rest.
- Use two narrow windows:
  - `now -> end of today`
  - `start of tomorrow -> end of tomorrow`
- Keep the `Tomorrow` output concise; prioritize the earliest or most relevant tomorrow items.
- Add `Upcoming` only when there are clearly notable later-week items worth calling out.
- If a calendar query times out, warm up Calendar.app (`osascript -e 'tell application "Calendar" to launch'`) and retry that calendar once before reporting it unavailable.
- If calendar access is unavailable or times out, report it as `Unavailable: <exact reason>` and keep partial results from other calendars.

## Reminders

- Read Apple Reminders via `osascript` with bounded timeouts (~25–30s).
- Focus on:
  - overdue reminders
  - reminders due today
  - reminders due tomorrow
  - only important upcoming reminders in the next 7 days
- If the first Reminders query times out, warm up Reminders.app (`osascript -e 'tell application "Reminders" to launch'`) and retry once before reporting it unavailable.
- Include due date/time when present.
- Keep the reminders section compact: usually no more than about 5 `Today` items, 3 `Tomorrow` items, and 3 `Important next` items.
- If Reminders access fails or times out, report it as `Unavailable: <exact reason>`.

## Runtime rules

- Gather fresh data at runtime.
- Bound network and `op` / 1Password-related calls; fail fast instead of hanging.
- Use `America/New_York` for all times.
- Do not guess missing calendar, reminder, or weather data.
- Prefer concise, actionable bullets over long prose.
- Avoid duplicate explanation blocks or source notes unless something is unavailable or a fallback was required.
- Keep the report concise (roughly 120 words when possible, unless the day genuinely requires more detail).
