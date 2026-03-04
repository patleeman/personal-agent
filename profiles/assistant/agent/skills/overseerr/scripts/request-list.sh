#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  request-list.sh [filter] [take] [skip] [sort] [requestedBy]

Defaults:
  filter=all
  take=20
  skip=0
  sort=added

Valid filter values:
  all, approved, available, pending, processing, unavailable, failed, deleted, completed

Valid sort values:
  added, modified

Example:
  request-list.sh pending 20 0 added
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 5 ]]; then
  usage >&2
  exit 1
fi

require_jq

filter="${1:-all}"
take="${2:-20}"
skip="${3:-0}"
sort="${4:-added}"
requested_by="${5:-}"

if ! [[ "$take" =~ ^[0-9]+$ ]]; then
  echo "Error: take must be a non-negative integer" >&2
  exit 1
fi

if ! [[ "$skip" =~ ^[0-9]+$ ]]; then
  echo "Error: skip must be a non-negative integer" >&2
  exit 1
fi

if [[ "$sort" != "added" && "$sort" != "modified" ]]; then
  echo "Error: sort must be 'added' or 'modified'" >&2
  exit 1
fi

path="/api/v1/request?filter=$filter&take=$take&skip=$skip&sort=$sort"
if [[ -n "$requested_by" ]]; then
  if ! [[ "$requested_by" =~ ^[0-9]+$ ]]; then
    echo "Error: requestedBy must be numeric" >&2
    exit 1
  fi

  path="$path&requestedBy=$requested_by"
fi

overseerr_api GET "$path" | jq '{pageInfo, results: [.results[] | {id, type, status, requestedBy: .requestedBy.displayName, media}]}'
