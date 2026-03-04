#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  movie-add.sh <term> <quality-profile-id> <root-folder-path> [minimum-availability] [search-for-movie] [monitor] [candidate-index]

Arguments:
  term                  Lookup term (title, tmdb:<id>, imdb:<id>)
  quality-profile-id    Numeric Radarr quality profile ID
  root-folder-path      Root folder path in Radarr
  minimum-availability  Optional tba|announced|inCinemas|released (default: released)
  search-for-movie      Optional true/false (default: true)
  monitor               Optional movieOnly|movieAndCollection|none (default: movieOnly)
  candidate-index       Optional lookup match index (default: 0)

Examples:
  movie-add.sh "tmdb:157336" 1 "/data/media/movies"
  movie-add.sh "Interstellar" 1 "/data/media/movies" released true movieOnly 0
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
minimum_availability="${4:-released}"
search_for_movie_raw="${5:-true}"
monitor="${6:-movieOnly}"
candidate_index="${7:-0}"

if ! [[ "$quality_profile_id" =~ ^[0-9]+$ ]]; then
  echo "Error: quality-profile-id must be numeric" >&2
  exit 1
fi

if ! [[ "$candidate_index" =~ ^[0-9]+$ ]]; then
  echo "Error: candidate-index must be a non-negative integer" >&2
  exit 1
fi

case "$minimum_availability" in
  tba|announced|inCinemas|released)
    ;;
  *)
    echo "Error: invalid minimum-availability '$minimum_availability'" >&2
    exit 1
    ;;
esac

case "$monitor" in
  movieOnly|movieAndCollection|none)
    ;;
  *)
    echo "Error: invalid monitor mode '$monitor'" >&2
    exit 1
    ;;
esac

search_for_movie="$(parse_bool "$search_for_movie_raw")"

api_key="$(resolve_radarr_api_key)"
base_url="$(resolve_radarr_base_url)"

lookup_json="$(curl -sS --fail-with-body \
  --connect-timeout "$radarr_curl_connect_timeout_seconds" \
  --max-time "$radarr_curl_max_time_seconds" \
  --get \
  -H "X-Api-Key: $api_key" \
  "$base_url/api/v3/movie/lookup" \
  --data-urlencode "term=$term")"

candidate="$(jq --argjson idx "$candidate_index" '.[ $idx ]' <<<"$lookup_json")"
if [[ "$candidate" == "null" ]]; then
  echo "Error: no lookup result found at index $candidate_index for term '$term'" >&2
  echo "$lookup_json" | jq '.[0:5] | map({title, year, tmdbId, imdbId})' >&2
  exit 1
fi

payload="$(jq \
  --arg root "$root_folder_path" \
  --argjson qp "$quality_profile_id" \
  --arg minimumAvailability "$minimum_availability" \
  --arg monitor "$monitor" \
  --argjson searchForMovie "$search_for_movie" \
  '.qualityProfileId = $qp
   | .rootFolderPath = $root
   | .monitored = true
   | .minimumAvailability = $minimumAvailability
   | .addOptions = { monitor: $monitor, searchForMovie: $searchForMovie }' \
  <<<"$candidate")"

radarr_api POST "/api/v3/movie" "$payload" | jq '{id, title, monitored, path, qualityProfileId, rootFolderPath, minimumAvailability}'
