#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_common.sh
source "$script_dir/_common.sh"

usage() {
  cat <<'EOF'
Usage:
  command-movies-search.sh <movie-id>

Queues a MoviesSearch command for an existing Radarr movie.
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

movie_id="$1"
if ! [[ "$movie_id" =~ ^[0-9]+$ ]]; then
  echo "Error: movie-id must be numeric" >&2
  exit 1
fi

payload="$(jq -n --argjson movieId "$movie_id" '{name:"MoviesSearch", movieIds:[$movieId]}')"
radarr_api POST "/api/v3/command" "$payload" | jq '{id, name, status, queued, started, ended}'
