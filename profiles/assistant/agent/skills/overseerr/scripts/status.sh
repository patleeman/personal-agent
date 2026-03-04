#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  status.sh

Shows Overseerr app status via GET /api/v1/status.

Optional environment:
  OVERSEERR_BASE_URL / OVERSEERR_BASE_URL_OP_REF
  OVERSEERR_API_KEY / OVERSEERR_API_KEY_OP_REF
  OVERSEERR_CURL_CONNECT_TIMEOUT_SECONDS (default: 10)
  OVERSEERR_CURL_MAX_TIME_SECONDS (default: 30)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage >&2
  exit 1
fi

require_jq
overseerr_api GET "/api/v1/status" | jq '{version, commitTag, totalRequests, totalMediaItems}'
