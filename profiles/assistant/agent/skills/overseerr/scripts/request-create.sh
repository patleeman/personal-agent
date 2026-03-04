#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  request-create.sh <movie|tv> <tmdb-id> [seasons]

Arguments:
  media type   movie or tv
  tmdb-id      TMDB numeric ID
  seasons      For TV only. Either "all" or comma-separated list (e.g. 1,2,3)

Examples:
  request-create.sh movie 603
  request-create.sh tv 1399 all
  request-create.sh tv 1399 1,2
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage >&2
  exit 1
fi

require_jq

media_type="$1"
media_id="$2"
seasons_raw="${3:-}"

if [[ "$media_type" != "movie" && "$media_type" != "tv" ]]; then
  echo "Error: media type must be 'movie' or 'tv'" >&2
  exit 1
fi

if ! [[ "$media_id" =~ ^[0-9]+$ ]]; then
  echo "Error: tmdb-id must be a positive integer" >&2
  exit 1
fi

payload="$(jq -n --arg mediaType "$media_type" --argjson mediaId "$media_id" '{mediaType:$mediaType, mediaId:$mediaId}')"

if [[ "$media_type" == "tv" && -n "$seasons_raw" ]]; then
  if [[ "$seasons_raw" == "all" ]]; then
    payload="$(jq '. + {seasons:"all"}' <<<"$payload")"
  else
    seasons_json="$(jq -n --arg raw "$seasons_raw" '
      ($raw | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(length > 0))) as $parts
      | if ($parts | length) == 0 then
          error("No seasons supplied")
        else
          ($parts | map(tonumber))
        end
    ')"
    payload="$(jq --argjson seasons "$seasons_json" '. + {seasons:$seasons}' <<<"$payload")"
  fi
fi

overseerr_api POST "/api/v1/request" "$payload" | jq '{id, type, status, requestedBy: .requestedBy.displayName, media}'
