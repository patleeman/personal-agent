#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  caldav-list-events.sh <start-utc> <end-utc> [calendar-url]

Arguments:
  start-utc     UTC timestamp in format YYYYMMDDTHHMMSSZ
  end-utc       UTC timestamp in format YYYYMMDDTHHMMSSZ
  calendar-url  Optional. Falls back to FASTMAIL_CALENDAR_URL

Required environment:
  FASTMAIL_USERNAME
  FASTMAIL_APP_PASSWORD

Example:
  caldav-list-events.sh 20260301T000000Z 20260308T000000Z
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage >&2
  exit 1
fi

start_utc="$1"
end_utc="$2"
calendar_url="${3:-${FASTMAIL_CALENDAR_URL:-}}"

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

if [[ -z "${FASTMAIL_APP_PASSWORD:-}" ]]; then
  echo "Error: FASTMAIL_APP_PASSWORD is required" >&2
  exit 1
fi

if [[ -z "$calendar_url" ]]; then
  echo "Error: calendar URL is required (arg 3 or FASTMAIL_CALENDAR_URL)" >&2
  exit 1
fi

read -r -d '' report_body <<XML || true
<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${start_utc}" end="${end_utc}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
XML

tmp_response="$(mktemp)"
trap 'rm -f "$tmp_response"' EXIT

http_status="$({
  curl -sS -u "$FASTMAIL_USERNAME:$FASTMAIL_APP_PASSWORD" \
    -X REPORT "$calendar_url" \
    -H "Depth: 1" \
    -H "Content-Type: application/xml; charset=utf-8" \
    --data "$report_body" \
    -o "$tmp_response" \
    -w "%{http_code}"
} )"

if [[ "$http_status" -lt 200 || "$http_status" -ge 300 ]]; then
  echo "CalDAV REPORT failed (HTTP $http_status)" >&2
  cat "$tmp_response" >&2
  exit 1
fi

cat "$tmp_response"
