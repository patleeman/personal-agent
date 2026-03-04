#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  movie-lookup.sh <term>

Examples:
  movie-lookup.sh "Interstellar"
  movie-lookup.sh "tmdb:157336"
  movie-lookup.sh "imdb:tt0816692"
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
api_key="$(resolve_radarr_api_key)"
base_url="$(resolve_radarr_base_url)"

curl -sS --fail-with-body \
  --connect-timeout "$radarr_curl_connect_timeout_seconds" \
  --max-time "$radarr_curl_max_time_seconds" \
  --get \
  -H "X-Api-Key: $api_key" \
  "$base_url/api/v3/movie/lookup" \
  --data-urlencode "term=$term" \
  | jq '.[] | {title, year, tmdbId, imdbId, studio}'
