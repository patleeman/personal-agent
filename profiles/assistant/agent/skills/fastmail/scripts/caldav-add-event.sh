#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  caldav-add-event.sh <summary> <start-utc> <end-utc> [calendar-url]

Arguments:
  summary       Event title
  start-utc     UTC timestamp in format YYYYMMDDTHHMMSSZ
  end-utc       UTC timestamp in format YYYYMMDDTHHMMSSZ
  calendar-url  Optional. Falls back to FASTMAIL_CALENDAR_URL

Required environment:
  FASTMAIL_USERNAME
  FASTMAIL_APP_PASSWORD

Example:
  caldav-add-event.sh "Planning Block" 20260303T150000Z 20260303T153000Z
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 3 || $# -gt 4 ]]; then
  usage >&2
  exit 1
fi

summary="$1"
start_utc="$2"
end_utc="$3"
calendar_url="${4:-${FASTMAIL_CALENDAR_URL:-}}"

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

if [[ -z "${FASTMAIL_APP_PASSWORD:-}" ]]; then
  echo "Error: FASTMAIL_APP_PASSWORD is required" >&2
  exit 1
fi

if [[ -z "$calendar_url" ]]; then
  echo "Error: calendar URL is required (arg 4 or FASTMAIL_CALENDAR_URL)" >&2
  exit 1
fi

escape_ics_text() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//;/\\;}"
  value="${value//,/\\,}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

if [[ "$calendar_url" != */ ]]; then
  calendar_url="${calendar_url}/"
fi

uid="$(uuidgen | tr '[:upper:]' '[:lower:]')"
dtstamp="$(date -u +%Y%m%dT%H%M%SZ)"
event_url="${calendar_url}${uid}.ics"
escaped_summary="$(escape_ics_text "$summary")"

tmp_ics="$(mktemp)"
tmp_response="$(mktemp)"
trap 'rm -f "$tmp_ics" "$tmp_response"' EXIT

cat > "$tmp_ics" <<EOF
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pi Fastmail Skill//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtstamp}
DTSTART:${start_utc}
DTEND:${end_utc}
SUMMARY:${escaped_summary}
END:VEVENT
END:VCALENDAR
EOF

http_status="$({
  curl -sS -u "$FASTMAIL_USERNAME:$FASTMAIL_APP_PASSWORD" \
    -X PUT "$event_url" \
    -H "Content-Type: text/calendar; charset=utf-8" \
    --data-binary "@$tmp_ics" \
    -o "$tmp_response" \
    -w "%{http_code}"
} )"

if [[ "$http_status" -lt 200 || "$http_status" -ge 299 ]]; then
  echo "CalDAV PUT failed (HTTP $http_status)" >&2
  cat "$tmp_response" >&2
  exit 1
fi

jq -n \
  --arg uid "$uid" \
  --arg url "$event_url" \
  --arg summary "$summary" \
  --arg start "$start_utc" \
  --arg end "$end_utc" \
  --argjson status "$http_status" \
  '{uid: $uid, eventUrl: $url, summary: $summary, startUtc: $start, endUtc: $end, httpStatus: $status}'
