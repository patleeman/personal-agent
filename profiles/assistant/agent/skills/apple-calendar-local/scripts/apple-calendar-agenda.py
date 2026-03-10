#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Iterable

DEFAULT_CALENDARS = [
    "Patrick Lee",
    "patrickc.lee@datadoghq.com",
    "Sanitation",
]

NOISY_CALENDARS = {
    "Holidays in United States",
    "US Holidays",
    "Birthdays",
    "Scheduled Reminders",
}

LIST_CALENDARS_SCRIPT = r'''
tell application "Calendar"
	set outLines to {}
	repeat with c in calendars
		set end of outLines to (name of c)
	end repeat
	if (count of outLines) = 0 then
		return "NONE"
	end if
	set AppleScript's text item delimiters to linefeed
	set outText to outLines as string
	set AppleScript's text item delimiters to ""
	return outText
end tell
'''

WARMUP_CALENDAR_SCRIPT = 'tell application "Calendar" to launch'

# Returns tab-delimited rows:
# start_iso<TAB>end_iso<TAB>all_day<TAB>title
QUERY_SCRIPT = r'''
on _clean_text(valueText)
	set t to valueText as text
	set t to my _replace(t, tab, " ")
	set t to my _replace(t, return, " ")
	set t to my _replace(t, linefeed, " ")
	return t
end _clean_text

on _replace(inputText, findText, replaceText)
	set AppleScript's text item delimiters to findText
	set textItems to every text item of inputText
	set AppleScript's text item delimiters to replaceText
	set outputText to textItems as text
	set AppleScript's text item delimiters to ""
	return outputText
end _replace

on run argv
	if (count of argv) < 1 then
		return "ERROR\tmissing-calendar-name"
	end if
	set calName to item 1 of argv

	set nowDate to current date
	set windowStart to nowDate + 0

	set todayEnd to nowDate + 0
	set hours of todayEnd to 23
	set minutes of todayEnd to 59
	set seconds of todayEnd to 59

	set tomorrowNoon to todayEnd + (12 * hours)

	tell application "Calendar"
		if not (exists calendar calName) then
			return "ERROR\tcalendar-not-found"
		end if

		set c to calendar calName
		set evs to (every event of c whose start date ≤ tomorrowNoon and end date ≥ windowStart)
		if (count of evs) = 0 then
			return "NONE"
		end if

		set outLines to {}
		repeat with ev in evs
			set s to start date of ev
			set e to end date of ev
			set dflag to allday event of ev
			set titleText to my _clean_text(summary of ev)
			set end of outLines to ((s as «class isot» as string) & "\t" & (e as «class isot» as string) & "\t" & (dflag as string) & "\t" & titleText)
		end repeat

		set AppleScript's text item delimiters to linefeed
		set outText to outLines as string
		set AppleScript's text item delimiters to ""
		return outText
	end tell
end run
'''


@dataclass(frozen=True)
class Event:
    calendar: str
    start: str
    end: str
    all_day: bool
    title: str


def _run_osascript(script: str, args: list[str], timeout_s: int) -> str:
    try:
        completed = subprocess.run(
            ["osascript", "-", *args],
            input=script,
            text=True,
            capture_output=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(f"osascript timed out after {timeout_s}s") from exc

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip() or "unknown osascript error"
        raise RuntimeError(stderr)

    return (completed.stdout or "").strip()


def _parse_datetime(value: str) -> datetime:
    raw = value.strip()
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is not None:
        dt = dt.astimezone().replace(tzinfo=None)
    return dt


def _warmup_calendar(timeout_s: int = 10) -> None:
    _run_osascript(WARMUP_CALENDAR_SCRIPT, [], timeout_s=max(1, timeout_s))


def list_calendars(timeout_s: int) -> list[str]:
    output = _run_osascript(LIST_CALENDARS_SCRIPT, [], timeout_s=timeout_s)
    if not output or output == "NONE":
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def fetch_calendar_events(calendar: str, timeout_s: int) -> tuple[list[Event], str | None]:
    try:
        output = _run_osascript(QUERY_SCRIPT, [calendar], timeout_s=timeout_s)
    except TimeoutError:
        try:
            _warmup_calendar(timeout_s=min(10, timeout_s))
            output = _run_osascript(QUERY_SCRIPT, [calendar], timeout_s=timeout_s)
        except TimeoutError:
            return [], "timed out"
        except Exception as exc:
            return [], f"osascript failure after retry: {exc}"
    except Exception as exc:
        return [], f"osascript failure: {exc}"

    if not output or output == "NONE":
        return [], None

    if output.startswith("ERROR\t"):
        _, _, reason = output.partition("\t")
        return [], reason or "unknown-error"

    events: list[Event] = []
    for line in output.splitlines():
        parts = line.split("\t", 3)
        if len(parts) != 4:
            continue
        start_iso, end_iso, all_day_raw, title = parts
        events.append(
            Event(
                calendar=calendar,
                start=start_iso,
                end=end_iso,
                all_day=all_day_raw.strip().lower() == "true",
                title=title.strip(),
            )
        )

    return events, None


def _dedupe(events: Iterable[Event]) -> list[Event]:
    seen: set[tuple[str, str, str, bool, str]] = set()
    deduped: list[Event] = []
    for event in events:
        key = (
            event.calendar,
            event.start,
            event.end,
            event.all_day,
            event.title,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(event)
    return deduped


def _sort(events: Iterable[Event]) -> list[Event]:
    return sorted(events, key=lambda e: (e.start, e.end, e.calendar, e.title.lower()))


def _format_clock(value: str) -> str:
    dt = _parse_datetime(value)
    clock = dt.strftime("%I:%M %p")
    return clock.lstrip("0")


def _render_text(today_events: list[Event], tomorrow_first: Event | None, unavailable: list[dict]) -> str:
    lines: list[str] = []

    lines.append("Today:")
    if not today_events:
        lines.append("- No events")
    else:
        for event in today_events:
            if event.all_day:
                lines.append(f"- All day · {event.title} ({event.calendar})")
            else:
                lines.append(
                    f"- {_format_clock(event.start)}–{_format_clock(event.end)} · {event.title} ({event.calendar})"
                )

    lines.append("Tomorrow AM:")
    if tomorrow_first is None:
        lines.append("- None")
    elif tomorrow_first.all_day:
        lines.append(f"- All day · {tomorrow_first.title} ({tomorrow_first.calendar})")
    else:
        lines.append(
            f"- {_format_clock(tomorrow_first.start)}–{_format_clock(tomorrow_first.end)} · {tomorrow_first.title} ({tomorrow_first.calendar})"
        )

    if unavailable:
        lines.append("Unavailable:")
        for row in unavailable:
            lines.append(f"- {row['calendar']}: {row['reason']}")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reliable local Apple Calendar agenda query via osascript")
    parser.add_argument(
        "--calendar",
        action="append",
        default=[],
        help="Calendar name to query (repeatable). Defaults to Patrick's morning-report calendars.",
    )
    parser.add_argument(
        "--all-calendars",
        action="store_true",
        help="Query all local calendars instead of defaults.",
    )
    parser.add_argument(
        "--include-noisy-calendars",
        action="store_true",
        help="When using --all-calendars, include Holidays/Birthdays/Scheduled Reminders calendars.",
    )
    parser.add_argument("--timeout", type=int, default=25, help="Per-calendar osascript timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--list-calendars", action="store_true", help="Only list local calendar names and exit")
    args = parser.parse_args()

    if args.list_calendars:
        try:
            calendars = list_calendars(timeout_s=args.timeout)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}, indent=2))
            return 1
        if args.json:
            print(json.dumps({"calendars": calendars}, indent=2, ensure_ascii=False))
        else:
            if not calendars:
                print("No calendars found")
            else:
                for name in calendars:
                    print(name)
        return 0

    if args.all_calendars:
        try:
            calendars = list_calendars(timeout_s=args.timeout)
        except Exception as exc:
            print(json.dumps({"error": str(exc)}, indent=2))
            return 1
        if not args.include_noisy_calendars:
            calendars = [name for name in calendars if name not in NOISY_CALENDARS]
    else:
        calendars = args.calendar or list(DEFAULT_CALENDARS)

    now = datetime.now()
    end_today = now.replace(hour=23, minute=59, second=59, microsecond=0)
    tomorrow_start = end_today + timedelta(seconds=1)
    tomorrow_noon = tomorrow_start.replace(hour=12, minute=0, second=0, microsecond=0)

    raw_events: list[Event] = []
    unavailable: list[dict[str, str]] = []

    for calendar in calendars:
        events, error = fetch_calendar_events(calendar=calendar, timeout_s=args.timeout)
        if error:
            unavailable.append({"calendar": calendar, "reason": error})
            continue
        raw_events.extend(events)

    # Suppress stale recurring master events and anything outside the actual window.
    scoped_events: list[Event] = []
    for event in raw_events:
        try:
            start_dt = _parse_datetime(event.start)
            end_dt = _parse_datetime(event.end)
        except Exception:
            continue

        if end_dt < now or start_dt > tomorrow_noon:
            continue

        scoped_events.append(event)

    deduped_events = _sort(_dedupe(scoped_events))

    today_events: list[Event] = []
    tomorrow_events: list[Event] = []

    for event in deduped_events:
        start_dt = _parse_datetime(event.start)
        end_dt = _parse_datetime(event.end)

        if start_dt <= end_today and end_dt >= now:
            today_events.append(event)

        if start_dt >= tomorrow_start and start_dt < tomorrow_noon:
            tomorrow_events.append(event)

    tomorrow_first = _sort(tomorrow_events)[0] if tomorrow_events else None

    payload: dict[str, object] = {
        "generated_at": now.isoformat(timespec="seconds"),
        "today_window": {
            "start": now.isoformat(timespec="seconds"),
            "end": end_today.isoformat(timespec="seconds"),
        },
        "tomorrow_am_window": {
            "start": tomorrow_start.isoformat(timespec="seconds"),
            "end": tomorrow_noon.isoformat(timespec="seconds"),
        },
        "calendars": calendars,
        "today_events": [asdict(event) for event in today_events],
        "tomorrow_am_first": asdict(tomorrow_first) if tomorrow_first else None,
        "unavailable": unavailable,
        "notes": [
            "Events are deduplicated by calendar/start/end/all_day/title.",
            "Window post-filter suppresses stale recurring master rows returned by Calendar AppleScript queries.",
        ],
    }

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(_render_text(today_events=today_events, tomorrow_first=tomorrow_first, unavailable=unavailable))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
