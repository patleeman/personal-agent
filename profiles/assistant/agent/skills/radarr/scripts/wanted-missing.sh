#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  wanted-missing.sh [page] [page-size]

Defaults:
  page=1
  page-size=20
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

require_jq

page="${1:-1}"
page_size="${2:-20}"

if ! [[ "$page" =~ ^[0-9]+$ ]] || (( page < 1 )); then
  echo "Error: page must be a positive integer" >&2
  exit 1
fi

if ! [[ "$page_size" =~ ^[0-9]+$ ]] || (( page_size < 1 )); then
  echo "Error: page-size must be a positive integer" >&2
  exit 1
fi

radarr_api GET "/api/v3/wanted/missing?page=$page&pageSize=$page_size" \
  | jq '{page, pageSize, totalRecords, records: [.records[] | {id, title, year}]}'
