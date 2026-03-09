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
  caldav-list-events.sh <start-utc> <end-utc> [calendar-url]

Arguments:
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

start_utc="$1"
end_utc="$2"
calendar_url="${3:-${FASTMAIL_CALENDAR_URL:-}}"

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
  curl -sS \
    --connect-timeout "$curl_connect_timeout_seconds" \
    --max-time "$curl_max_time_seconds" \
    -u "$FASTMAIL_USERNAME:$fastmail_app_password" \
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
