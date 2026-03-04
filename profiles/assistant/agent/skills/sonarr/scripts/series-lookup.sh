#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  series-lookup.sh <term>

Examples:
  series-lookup.sh "Breaking Bad"
  series-lookup.sh "tvdb:81189"
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

term="$1"
api_key="$(resolve_sonarr_api_key)"
base_url="$(resolve_sonarr_base_url)"

curl -sS --fail-with-body \
  --connect-timeout "$sonarr_curl_connect_timeout_seconds" \
  --max-time "$sonarr_curl_max_time_seconds" \
  --get \
  -H "X-Api-Key: $api_key" \
  "$base_url/api/v3/series/lookup" \
  --data-urlencode "term=$term" \
  | jq '.[] | {title, year, tvdbId, tmdbId, imdbId, network}'
