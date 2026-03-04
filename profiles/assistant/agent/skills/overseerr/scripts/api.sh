#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  api.sh <METHOD> <PATH> [json-file|-]

Examples:
  api.sh GET /api/v1/status
  api.sh GET /api/v1/request?take=10
  api.sh POST /api/v1/request payload.json
  echo '{"mediaType":"movie","mediaId":603}' | api.sh POST /api/v1/request -
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

method="$1"
path="$2"
payload_source="${3:-}"
payload=""

if [[ -n "$payload_source" ]]; then
  if [[ "$payload_source" == "-" ]]; then
    payload="$(cat)"
  else
    if [[ ! -f "$payload_source" ]]; then
      echo "Error: payload file not found: $payload_source" >&2
      exit 1
    fi

    payload="$(<"$payload_source")"
  fi
fi

if [[ -n "$payload" ]]; then
  overseerr_api "$method" "$path" "$payload"
else
  overseerr_api "$method" "$path"
fi
