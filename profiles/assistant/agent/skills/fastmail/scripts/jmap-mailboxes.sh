#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OP_READ_TIMEOUT_SECONDS=15
DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS=10
DEFAULT_CURL_MAX_TIME_SECONDS=30

usage() {
  cat <<'EOF'
Usage:
  jmap-mailboxes.sh

Required environment:
  FASTMAIL_JMAP_API_TOKEN

Optional environment:
  FASTMAIL_JMAP_API_TOKEN_OP_REF (default fallback: op://Assistant/FASTMAIL_JMAP_API_TOKEN/credential)
  FASTMAIL_JMAP_SESSION_URL (default: https://api.fastmail.com/jmap/session)
  FASTMAIL_OP_READ_TIMEOUT_SECONDS (default: 15)
  FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS (default: 10)
  FASTMAIL_CURL_MAX_TIME_SECONDS (default: 30)

Output:
  JSON array of mailboxes with id/name/role/totalEmails/unreadEmails
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
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

OP_READ_TIMEOUT_SECONDS="$(resolve_positive_int "${FASTMAIL_OP_READ_TIMEOUT_SECONDS:-$DEFAULT_OP_READ_TIMEOUT_SECONDS}" "$DEFAULT_OP_READ_TIMEOUT_SECONDS")"
CURL_CONNECT_TIMEOUT_SECONDS="$(resolve_positive_int "${FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS:-$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS}" "$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS")"
CURL_MAX_TIME_SECONDS="$(resolve_positive_int "${FASTMAIL_CURL_MAX_TIME_SECONDS:-$DEFAULT_CURL_MAX_TIME_SECONDS}" "$DEFAULT_CURL_MAX_TIME_SECONDS")"

curl_with_timeouts() {
  curl -sS \
    --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" \
    --max-time "$CURL_MAX_TIME_SECONDS" \
    "$@"
}

op_read_reference() {
  local reference="$1"

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$OP_READ_TIMEOUT_SECONDS" op --cache=false read "$reference"
    return
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "$OP_READ_TIMEOUT_SECONDS" op --cache=false read "$reference"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node - "$reference" "$OP_READ_TIMEOUT_SECONDS" <<'NODE'
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

resolve_fastmail_jmap_api_token() {
  local configured_value="${FASTMAIL_JMAP_API_TOKEN:-}"
  if [[ -n "$configured_value" ]]; then
    if [[ "$configured_value" == op://* ]]; then
      if ! command -v op >/dev/null 2>&1; then
        echo "Error: op CLI is required to resolve FASTMAIL_JMAP_API_TOKEN reference" >&2
        return 1
      fi

      op_read_reference "$configured_value"
      return
    fi

    printf '%s' "$configured_value"
    return
  fi

  local fallback_ref="${FASTMAIL_JMAP_API_TOKEN_OP_REF:-op://Assistant/FASTMAIL_JMAP_API_TOKEN/credential}"
  if ! command -v op >/dev/null 2>&1; then
    echo "Error: FASTMAIL_JMAP_API_TOKEN is required, or install op to use FASTMAIL_JMAP_API_TOKEN_OP_REF" >&2
    return 1
  fi

  op_read_reference "$fallback_ref"
}

if ! fastmail_jmap_api_token="$(resolve_fastmail_jmap_api_token)"; then
  exit 1
fi

if [[ -z "$fastmail_jmap_api_token" ]]; then
  echo "Error: Fastmail JMAP API token resolved to an empty value" >&2
  exit 1
fi

session_url="${FASTMAIL_JMAP_SESSION_URL:-https://api.fastmail.com/jmap/session}"

tmp_session_response="$(mktemp)"
tmp_api_response="$(mktemp)"
trap 'rm -f "$tmp_session_response" "$tmp_api_response"' EXIT

session_status="$({
  curl_with_timeouts \
    -H "Authorization: Bearer $fastmail_jmap_api_token" \
    "$session_url" \
    -o "$tmp_session_response" \
    -w "%{http_code}"
} )"

session_json="$(cat "$tmp_session_response")"

if [[ "$session_status" -lt 200 || "$session_status" -ge 300 ]]; then
  echo "Error: JMAP session request failed (HTTP $session_status)" >&2
  echo "$session_json" >&2
  exit 1
fi

if ! echo "$session_json" | jq -e . >/dev/null 2>&1; then
  echo "Error: JMAP session response was not valid JSON" >&2
  echo "$session_json" >&2
  exit 1
fi

api_url="$(echo "$session_json" | jq -r '.apiUrl // empty')"
account_id="$(echo "$session_json" | jq -r '.primaryAccounts["urn:ietf:params:jmap:mail"] // empty')"

if [[ -z "$api_url" || -z "$account_id" ]]; then
  echo "Error: could not resolve JMAP apiUrl/accountId from session" >&2
  echo "$session_json" | jq . >&2 || echo "$session_json" >&2
  exit 1
fi

payload="$(jq -n \
  --arg accountId "$account_id" \
  '{
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Mailbox/get", {accountId: $accountId}, "m1"]
    ]
  }'
)"

api_status="$({
  curl_with_timeouts \
    -H "Authorization: Bearer $fastmail_jmap_api_token" \
    -H "Content-Type: application/json" \
    "$api_url" \
    --data "$payload" \
    -o "$tmp_api_response" \
    -w "%{http_code}"
} )"

response_json="$(cat "$tmp_api_response")"

if [[ "$api_status" -lt 200 || "$api_status" -ge 300 ]]; then
  echo "Error: JMAP Mailbox/get request failed (HTTP $api_status)" >&2
  echo "$response_json" >&2
  exit 1
fi

if ! echo "$response_json" | jq -e . >/dev/null 2>&1; then
  echo "Error: JMAP Mailbox/get response was not valid JSON" >&2
  echo "$response_json" >&2
  exit 1
fi

echo "$response_json" \
  | jq '.methodResponses[0][1].list
    | sort_by(.name)
    | map({id, name, role, totalEmails, unreadEmails})'
