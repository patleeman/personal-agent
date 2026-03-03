#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS=10
DEFAULT_CURL_MAX_TIME_SECONDS=30

usage() {
  cat <<'EOF'
Usage:
  caldav-delete-event.sh <event-url-or-filename> [calendar-url]

Arguments:
  event-url-or-filename  Full event URL, or event filename like abc.ics
  calendar-url           Required only when first arg is a filename.
                         Falls back to FASTMAIL_CALENDAR_URL.

Required environment:
  FASTMAIL_USERNAME
  FASTMAIL_APP_PASSWORD

Optional environment:
  FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS (default: 10)
  FASTMAIL_CURL_MAX_TIME_SECONDS (default: 30)

Examples:
  caldav-delete-event.sh https://caldav.fastmail.com/.../abcd.ics
  caldav-delete-event.sh abcd.ics
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

resolve_positive_int() {
  local raw="${1:-}"
  local fallback="$2"

  if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw > 0 )); then
    printf '%s' "$raw"
    return
  fi

  printf '%s' "$fallback"
}

curl_connect_timeout_seconds="$(resolve_positive_int "${FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS:-$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS}" "$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS")"
curl_max_time_seconds="$(resolve_positive_int "${FASTMAIL_CURL_MAX_TIME_SECONDS:-$DEFAULT_CURL_MAX_TIME_SECONDS}" "$DEFAULT_CURL_MAX_TIME_SECONDS")"

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

if [[ -z "${FASTMAIL_APP_PASSWORD:-}" ]]; then
  echo "Error: FASTMAIL_APP_PASSWORD is required" >&2
  exit 1
fi

event_ref="$1"
calendar_url="${2:-${FASTMAIL_CALENDAR_URL:-}}"

if [[ "$event_ref" == https://* || "$event_ref" == http://* ]]; then
  event_url="$event_ref"
else
  if [[ -z "$calendar_url" ]]; then
    echo "Error: calendar URL is required when using event filename" >&2
    exit 1
  fi

  if [[ "$calendar_url" != */ ]]; then
    calendar_url="${calendar_url}/"
  fi

  event_url="${calendar_url}${event_ref}"
fi

tmp_response="$(mktemp)"
trap 'rm -f "$tmp_response"' EXIT

http_status="$({
  curl -sS \
    --connect-timeout "$curl_connect_timeout_seconds" \
    --max-time "$curl_max_time_seconds" \
    -u "$FASTMAIL_USERNAME:$FASTMAIL_APP_PASSWORD" \
    -X DELETE "$event_url" \
    -o "$tmp_response" \
    -w "%{http_code}"
} )"

if [[ "$http_status" -lt 200 || "$http_status" -ge 300 ]]; then
  echo "CalDAV DELETE failed (HTTP $http_status)" >&2
  cat "$tmp_response" >&2
  exit 1
fi

jq -n --arg url "$event_url" --argjson status "$http_status" '{eventUrl: $url, httpStatus: $status, deleted: true}'
