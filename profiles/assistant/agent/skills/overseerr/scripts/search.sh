#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  search.sh <query> [page] [language]

Examples:
  search.sh "The Matrix"
  search.sh "Dune" 1 en
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 || $# -gt 3 ]]; then
  usage >&2
  exit 1
fi

require_jq

query="$1"
page="${2:-1}"
language="${3:-}"

if ! [[ "$page" =~ ^[0-9]+$ ]] || (( page < 1 )); then
  echo "Error: page must be a positive integer" >&2
  exit 1
fi

api_key="$(resolve_overseerr_api_key)"
base_url="$(resolve_overseerr_base_url)"

query_encoded="$(jq -rn --arg value "$query" '$value | @uri')"
url="$base_url/api/v1/search?query=$query_encoded&page=$page"

if [[ -n "$language" ]]; then
  language_encoded="$(jq -rn --arg value "$language" '$value | @uri')"
  url="$url&language=$language_encoded"
fi

curl -sS --fail-with-body \
  --connect-timeout "$overseerr_curl_connect_timeout_seconds" \
  --max-time "$overseerr_curl_max_time_seconds" \
  -H "X-Api-Key: $api_key" \
  "$url" \
  | jq '{page, totalPages, totalResults, results: [.results[] | {mediaType, id, title, name, releaseDate, firstAirDate}]}'
