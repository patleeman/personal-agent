---
id: morning-report
enabled: true
cron: "30 6 * * *"
profile: "assistant"
model: "openai-codex/gpt-5.4"
cwd: "~/workingdir"
timeoutSeconds: 1200
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "-1003854487728"
      messageThreadId: 22
---
Create my **Morning Report** for White Plains, NY.

Goal: a short, glanceable assistant-style update with only high-signal info.

Execution requirements:
- Fully agentic: gather fresh data at runtime on every run.
- For network APIs and `op`, fail fast (cap each call around ~30s, no hanging calls).
- Use local timezone (`America/New_York`) for all times.
- Do not guess. If a source is unavailable, say `Unavailable: <exact reason>`.

Data sources:

1) **Weather (required)**
- Prefer `wttr.in` (`https://wttr.in/White%20Plains,NY?format=j1`), with free fallback if needed.
- Gather: now temp/feels/condition, today high/low, and precipitation outlook.

2) **Calendar (Apple Calendar, local)**
- Use built-in Apple Calendar via `osascript` only (local Calendar app data).
- Do **not** use Fastmail/CalDAV scripts for this report.
- Include **only** these Apple calendars:
  - `Patrick Lee` (personal)
  - `patrickc.lee@datadoghq.com` (work)
  - `Sanitation` (iCloud)
- Do not query Holidays, Birthdays, Scheduled Reminders, or any other calendar.
- Query the three target calendars individually (not one giant query), with per-calendar timeout guards.
- Use **narrow windows** per calendar:
  - query A: now → end of today
  - query B: end of today → tomorrow 12:00 PM
- Keep AppleScript timeout bounded (about 20–25s per calendar). If a specific calendar/account times out, skip it and continue; include a short note like `Unavailable: <calendar> timed out`.
- Pull events from now through end of today, plus first event tomorrow before noon.
- For event rows include time, title, and calendar name.

3) **Apple Reminders**
- Use `osascript`.
- Focus on:
  - overdue reminders
  - reminders due today
  - only truly important upcoming reminders (next 7 days)

Output format (follow exactly):

# ☀️ Morning Report
*White Plains, NY · <generated local time>*

## ━━ 🌤️ WEATHER ━━
<ONE sentence only: now + today high/low + practical note>

## ━━ 📅 CALENDAR ━━
- **Today:** <"No events" or up to 3 upcoming events>
- **Tomorrow AM:** <first event before noon or "None">

## ━━ ✅ REMINDERS ━━
- **Today:** <overdue + due today, max 5 bullets>
- **Important next:** <only high-priority upcoming, max 3 bullets>

Hard constraints:
- Keep it tight (target <= 120 words, unless critical items require slightly more).
- No "Quick Take" section.
- No duplicate weather summary + details blocks.
- No source notes unless something is unavailable.
- Do **not** include: `Morning report complete.`
