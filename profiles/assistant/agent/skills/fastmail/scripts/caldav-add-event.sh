#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OP_READ_TIMEOUT_SECONDS=15
DEFAULT_PRIMARY_FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_APP_PASSWORD/password"
DEFAULT_LEGACY_FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_API_KEY/password"
DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS=10
DEFAULT_CURL_MAX_TIME_SECONDS=30

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
  FASTMAIL_APP_PASSWORD (or FASTMAIL_APP_PASSWORD_OP_REF)

Optional environment:
  FASTMAIL_APP_PASSWORD_OP_REF (default preferred ref: op://Assistant/FASTMAIL_APP_PASSWORD/password; legacy fallback: op://Assistant/FASTMAIL_API_KEY/password)
  FASTMAIL_OP_READ_TIMEOUT_SECONDS (default: 15)
  FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS (default: 10)
  FASTMAIL_CURL_MAX_TIME_SECONDS (default: 30)

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

resolve_positive_int() {
  local raw="${1:-}"
  local fallback="$2"

  if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw > 0 )); then
    printf '%s' "$raw"
    return
  fi

  printf '%s' "$fallback"
}

op_read_timeout_seconds="$(resolve_positive_int "${FASTMAIL_OP_READ_TIMEOUT_SECONDS:-$DEFAULT_OP_READ_TIMEOUT_SECONDS}" "$DEFAULT_OP_READ_TIMEOUT_SECONDS")"
curl_connect_timeout_seconds="$(resolve_positive_int "${FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS:-$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS}" "$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS")"
curl_max_time_seconds="$(resolve_positive_int "${FASTMAIL_CURL_MAX_TIME_SECONDS:-$DEFAULT_CURL_MAX_TIME_SECONDS}" "$DEFAULT_CURL_MAX_TIME_SECONDS")"

summary="$1"
start_utc="$2"
end_utc="$3"
calendar_url="${4:-${FASTMAIL_CALENDAR_URL:-}}"

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

op_read_reference() {
  local reference="$1"

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "$op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node - "$reference" "$op_read_timeout_seconds" <<'NODE'
const { spawnSync } = require('node:child_process');

const reference = process.argv[2];
const timeoutSeconds = Number.parseInt(process.argv[3], 10);
const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
  ? timeoutSeconds * 1000
  : 15_000;

const result = spawnSync('op', ['--cache=false', 'read', reference], {
  encoding: 'utf-8',
  env: process.env,
  timeout: timeoutMs,
});

if (result.error) {
  const code = result.error.code;

  if (code === 'ETIMEDOUT') {
    process.stderr.write(`Error: timed out after ${Math.floor(timeoutMs / 1000)}s while reading 1Password reference\n`);
    process.exit(1);
  }

  if (code === 'ENOENT') {
    process.stderr.write('Error: op CLI not found while resolving 1Password reference\n');
    process.exit(1);
  }

  process.stderr.write(`Error: failed to execute op read: ${result.error.message}\n`);
  process.exit(1);
}

const status = result.status ?? 1;
if (status !== 0) {
  const detail = (result.stderr || result.stdout || '').trim();
  if (detail.length > 0) {
    process.stderr.write(`${detail}\n`);
  } else {
    process.stderr.write(`Error: op read exited with code ${status}\n`);
  }

  process.exit(status);
}

process.stdout.write(result.stdout ?? '');
NODE
    return
  fi

  op --cache=false read "$reference"
}

resolve_default_fastmail_app_password_reference() {
  local primary_ref="$DEFAULT_PRIMARY_FASTMAIL_APP_PASSWORD_OP_REF"
  local legacy_ref="$DEFAULT_LEGACY_FASTMAIL_APP_PASSWORD_OP_REF"
  local resolved_value=""

  if resolved_value="$(op_read_reference "$primary_ref" 2>/dev/null)"; then
    printf '%s' "$resolved_value"
    return
  fi

  if [[ "$legacy_ref" != "$primary_ref" ]] && resolved_value="$(op_read_reference "$legacy_ref" 2>/dev/null)"; then
    printf '%s' "$resolved_value"
    return
  fi

  op_read_reference "$primary_ref"
}

resolve_fastmail_app_password() {
  local configured_value="${FASTMAIL_APP_PASSWORD:-}"

  if [[ -n "$configured_value" ]]; then
    if [[ "$configured_value" == op://* ]]; then
      if ! command -v op >/dev/null 2>&1; then
        echo "Error: op CLI is required to resolve FASTMAIL_APP_PASSWORD reference" >&2
        return 1
      fi

      op_read_reference "$configured_value"
      return
    fi

    printf '%s' "$configured_value"
    return
  fi

  if ! command -v op >/dev/null 2>&1; then
    echo "Error: FASTMAIL_APP_PASSWORD is required, or install op to use FASTMAIL_APP_PASSWORD_OP_REF" >&2
    return 1
  fi

  if [[ -n "${FASTMAIL_APP_PASSWORD_OP_REF:-}" ]]; then
    op_read_reference "$FASTMAIL_APP_PASSWORD_OP_REF"
    return
  fi

  resolve_default_fastmail_app_password_reference
}

if ! fastmail_app_password="$(resolve_fastmail_app_password)"; then
  exit 1
fi

if [[ -z "$fastmail_app_password" ]]; then
  echo "Error: Fastmail app password resolved to an empty value" >&2
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
  curl -sS \
    --connect-timeout "$curl_connect_timeout_seconds" \
    --max-time "$curl_max_time_seconds" \
    -u "$FASTMAIL_USERNAME:$fastmail_app_password" \
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
