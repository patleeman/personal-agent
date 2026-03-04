#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  request-set-status.sh <request-id> <approve|decline|retry|delete>

Examples:
  request-set-status.sh 123 approve
  request-set-status.sh 123 decline
  request-set-status.sh 123 retry
  request-set-status.sh 123 delete
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 1
fi

require_jq

request_id="$1"
action="$2"

if ! [[ "$request_id" =~ ^[0-9]+$ ]]; then
  echo "Error: request-id must be a positive integer" >&2
  exit 1
fi

case "$action" in
  approve|decline)
    overseerr_api POST "/api/v1/request/$request_id/$action" | jq '{id, status, type, media}'
    ;;
  retry)
    overseerr_api POST "/api/v1/request/$request_id/retry" | jq '{id, status, type, media}'
    ;;
  delete)
    overseerr_api DELETE "/api/v1/request/$request_id"
    jq -n --argjson requestId "$request_id" '{ok:true, action:"delete", requestId:$requestId}'
    ;;
  *)
    echo "Error: action must be approve, decline, retry, or delete" >&2
    exit 1
    ;;
esac
