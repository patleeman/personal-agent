#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  auth-me.sh

Returns currently authenticated Overseerr user via GET /api/v1/auth/me.
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
overseerr_api GET "/api/v1/auth/me" | jq '{id, email, displayName, permissions, userType}'
