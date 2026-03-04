#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  series-add.sh <term> <quality-profile-id> <root-folder-path> [monitor] [search-for-missing] [season-folder] [candidate-index]

Arguments:
  term                Lookup term (title, tvdb:<id>, imdb:<id>)
  quality-profile-id  Numeric Sonarr quality profile ID
  root-folder-path    Root folder path in Sonarr
  monitor             Optional monitor mode (default: all)
  search-for-missing  Optional true/false (default: true)
  season-folder       Optional true/false (default: true)
  candidate-index     Optional lookup match index (default: 0)

Examples:
  series-add.sh "tvdb:81189" 1 "/data/media/tv"
  series-add.sh "Severance" 1 "/data/media/tv" all true true 0
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 3 || $# -gt 7 ]]; then
  usage >&2
  exit 1
fi

require_jq

parse_bool() {
  local raw="$1"
  case "$raw" in
    true|TRUE|True|1|yes|YES|y|Y) printf 'true' ;;
    false|FALSE|False|0|no|NO|n|N) printf 'false' ;;
    *)
      echo "Error: expected boolean value (true/false), got '$raw'" >&2
      return 1
      ;;
  esac
}

term="$1"
quality_profile_id="$2"
root_folder_path="$3"
monitor="${4:-all}"
search_for_missing_raw="${5:-true}"
season_folder_raw="${6:-true}"
candidate_index="${7:-0}"

if ! [[ "$quality_profile_id" =~ ^[0-9]+$ ]]; then
  echo "Error: quality-profile-id must be numeric" >&2
  exit 1
fi

if ! [[ "$candidate_index" =~ ^[0-9]+$ ]]; then
  echo "Error: candidate-index must be a non-negative integer" >&2
  exit 1
fi

case "$monitor" in
  unknown|all|future|missing|existing|firstSeason|lastSeason|latestSeason|pilot|recent|monitorSpecials|unmonitorSpecials|none|skip)
    ;;
  *)
    echo "Error: invalid monitor mode '$monitor'" >&2
    exit 1
    ;;
esac

search_for_missing="$(parse_bool "$search_for_missing_raw")"
season_folder="$(parse_bool "$season_folder_raw")"

api_key="$(resolve_sonarr_api_key)"
base_url="$(resolve_sonarr_base_url)"

lookup_json="$(curl -sS --fail-with-body \
  --connect-timeout "$sonarr_curl_connect_timeout_seconds" \
  --max-time "$sonarr_curl_max_time_seconds" \
  --get \
  -H "X-Api-Key: $api_key" \
  "$base_url/api/v3/series/lookup" \
  --data-urlencode "term=$term")"

candidate="$(jq --argjson idx "$candidate_index" '.[ $idx ]' <<<"$lookup_json")"
if [[ "$candidate" == "null" ]]; then
  echo "Error: no lookup result found at index $candidate_index for term '$term'" >&2
  echo "$lookup_json" | jq '.[0:5] | map({title, year, tvdbId, tmdbId, imdbId})' >&2
  exit 1
fi

payload="$(jq \
  --arg root "$root_folder_path" \
  --argjson qp "$quality_profile_id" \
  --arg monitor "$monitor" \
  --argjson searchForMissingEpisodes "$search_for_missing" \
  --argjson seasonFolder "$season_folder" \
  '.qualityProfileId = $qp
   | .rootFolderPath = $root
   | .seasonFolder = $seasonFolder
   | .monitored = true
   | .addOptions = { monitor: $monitor, searchForMissingEpisodes: $searchForMissingEpisodes }' \
  <<<"$candidate")"

sonarr_api POST "/api/v3/series" "$payload" | jq '{id, title, monitored, path, qualityProfileId, rootFolderPath}'
