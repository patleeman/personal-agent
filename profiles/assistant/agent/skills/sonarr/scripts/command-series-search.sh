#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  command-series-search.sh <series-id>

Queues a SeriesSearch command for an existing Sonarr series.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

require_jq

series_id="$1"
if ! [[ "$series_id" =~ ^[0-9]+$ ]]; then
  echo "Error: series-id must be numeric" >&2
  exit 1
fi

payload="$(jq -n --argjson seriesId "$series_id" '{name:"SeriesSearch", seriesId:$seriesId}')"
sonarr_api POST "/api/v3/command" "$payload" | jq '{id, name, status, queued, started, ended}'
