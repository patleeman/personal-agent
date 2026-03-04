#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OP_READ_TIMEOUT_SECONDS=15
DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS=10
DEFAULT_CURL_MAX_TIME_SECONDS=30
DEFAULT_OVERSEERR_BASE_URL="http://localhost:5055"

resolve_positive_int() {
  local raw="${1:-}"
  local fallback="$2"

  if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw > 0 )); then
    printf '%s' "$raw"
    return
  fi

  printf '%s' "$fallback"
}

overseerr_op_read_timeout_seconds="$(resolve_positive_int "${OVERSEERR_OP_READ_TIMEOUT_SECONDS:-$DEFAULT_OP_READ_TIMEOUT_SECONDS}" "$DEFAULT_OP_READ_TIMEOUT_SECONDS")"
overseerr_curl_connect_timeout_seconds="$(resolve_positive_int "${OVERSEERR_CURL_CONNECT_TIMEOUT_SECONDS:-$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS}" "$DEFAULT_CURL_CONNECT_TIMEOUT_SECONDS")"
overseerr_curl_max_time_seconds="$(resolve_positive_int "${OVERSEERR_CURL_MAX_TIME_SECONDS:-$DEFAULT_CURL_MAX_TIME_SECONDS}" "$DEFAULT_CURL_MAX_TIME_SECONDS")"

overseerr_op_read_reference() {
  local reference="$1"

  if ! command -v op >/dev/null 2>&1; then
    echo "Error: op CLI is required to resolve 1Password reference '$reference'" >&2
    return 1
  fi

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$overseerr_op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "$overseerr_op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node - "$reference" "$overseerr_op_read_timeout_seconds" <<'NODE'
const { spawnSync } = require('node:child_process');

const reference = process.argv[2];
const timeoutSeconds = Number.parseInt(process.argv[3], 10);
const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
  ? timeoutSeconds * 1000
  : 15000;

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

resolve_overseerr_api_key() {
  local configured_value="${OVERSEERR_API_KEY:-}"

  if [[ -n "$configured_value" ]]; then
    if [[ "$configured_value" == op://* ]]; then
      overseerr_op_read_reference "$configured_value"
      return
    fi

    printf '%s' "$configured_value"
    return
  fi

  local fallback_ref="${OVERSEERR_API_KEY_OP_REF:-op://Assistant/Overseerr/API_KEY}"
  overseerr_op_read_reference "$fallback_ref"
}

resolve_overseerr_base_url() {
  local configured_value="${OVERSEERR_BASE_URL:-}"

  if [[ -n "$configured_value" ]]; then
    if [[ "$configured_value" == op://* ]]; then
      configured_value="$(overseerr_op_read_reference "$configured_value")"
    fi

    configured_value="${configured_value%/}"
    if [[ -z "$configured_value" ]]; then
      echo "Error: OVERSEERR_BASE_URL resolved to empty value" >&2
      return 1
    fi

    printf '%s' "$configured_value"
    return
  fi

  local fallback_ref="${OVERSEERR_BASE_URL_OP_REF:-op://Assistant/Overseerr/url}"
  local resolved=""
  if command -v op >/dev/null 2>&1; then
    if resolved="$(overseerr_op_read_reference "$fallback_ref" 2>/dev/null)" && [[ -n "$resolved" ]]; then
      printf '%s' "${resolved%/}"
      return
    fi
  fi

  printf '%s' "$DEFAULT_OVERSEERR_BASE_URL"
}

overseerr_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  if [[ -z "$method" || -z "$path" ]]; then
    echo "Error: overseerr_api requires method and path" >&2
    return 1
  fi

  local api_key
  if ! api_key="$(resolve_overseerr_api_key)"; then
    echo "Error: unable to resolve Overseerr API key" >&2
    return 1
  fi

  if [[ -z "$api_key" ]]; then
    echo "Error: Overseerr API key resolved to empty value" >&2
    return 1
  fi

  local base_url
  if ! base_url="$(resolve_overseerr_base_url)"; then
    return 1
  fi

  if [[ "$path" != /* ]]; then
    path="/$path"
  fi

  if [[ -n "$data" ]]; then
    curl -sS --fail-with-body \
      --connect-timeout "$overseerr_curl_connect_timeout_seconds" \
      --max-time "$overseerr_curl_max_time_seconds" \
      -X "$method" \
      -H "X-Api-Key: $api_key" \
      -H "Content-Type: application/json" \
      "$base_url$path" \
      -d "$data"
  else
    curl -sS --fail-with-body \
      --connect-timeout "$overseerr_curl_connect_timeout_seconds" \
      --max-time "$overseerr_curl_max_time_seconds" \
      -X "$method" \
      -H "X-Api-Key: $api_key" \
      "$base_url$path"
  fi
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "Error: jq is required" >&2
    exit 1
  fi
}
