---
name: radarr
description: Manage Radarr (movies) with the Radarr v3 API using curl + jq. Use when the user asks to search/add/update movies, inspect queue/calendar, or trigger movie searches.
---

# Radarr (API-first)

Use direct API calls to Radarr (`/api/v3/...`) with `curl` + `jq`.

## Environment

```bash
# Base URL (optional). If unset, scripts try RADARR_BASE_URL_OP_REF first.
export RADARR_BASE_URL="http://localhost:7878"
# Recommended default fallback reference for base URL:
export RADARR_BASE_URL_OP_REF="op://Assistant/Radarr/url"

# API key (optional plain value or op:// reference)
export RADARR_API_KEY="op://Assistant/Radarr/API_KEY"
# Default fallback reference if RADARR_API_KEY is unset:
export RADARR_API_KEY_OP_REF="op://Assistant/Radarr/API_KEY"
```

Get API key from: `Radarr -> Settings -> General -> Security -> API Key`

## Reusable shell helpers

```bash
resolve_radarr_api_key() {
  if [ -n "${RADARR_API_KEY:-}" ]; then
    if [[ "$RADARR_API_KEY" == op://* ]]; then
      op read "$RADARR_API_KEY"
    else
      printf '%s' "$RADARR_API_KEY"
    fi
    return
  fi

  op read "${RADARR_API_KEY_OP_REF:-op://Assistant/Radarr/API_KEY}"
}

radarr_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local api_key
  if ! api_key="$(resolve_radarr_api_key)"; then
    echo "Unable to resolve Radarr API key (check op CLI auth / RADARR_API_KEY)" >&2
    return 1
  fi

  local base="${RADARR_BASE_URL:-http://localhost:7878}"
  base="${base%/}"

  if [ -n "$data" ]; then
    curl -sS --fail-with-body -X "$method" \
      -H "X-Api-Key: $api_key" \
      -H "Content-Type: application/json" \
      "$base$path" \
      -d "$data"
  else
    curl -sS --fail-with-body -X "$method" \
      -H "X-Api-Key: $api_key" \
      "$base$path"
  fi
}
```

## Bundled scripts (preferred)

Use the scripts in `scripts/` for repeatable operations:

```bash
# Generic API wrapper
./scripts/api.sh GET /api/v3/system/status

# Status / lookup
./scripts/system-status.sh
./scripts/movie-lookup.sh "tmdb:157336"

# Add movie
./scripts/movie-add.sh "tmdb:157336" 1 "/data/media/movies"

# Trigger search and inspect backlog
./scripts/command-movies-search.sh 456
./scripts/queue-list.sh 1 20
./scripts/wanted-missing.sh 1 20
```

## Common workflows

### 1) Service, profiles, and root folders

```bash
radarr_api GET "/api/v3/system/status" | jq '{version, appName, instanceName}'

radarr_api GET "/api/v3/qualityprofile" | jq '.[] | {id, name}'
radarr_api GET "/api/v3/rootfolder" | jq '.[] | {id, path, accessible}'
```

### 2) Lookup candidate movies

```bash
token="$(resolve_radarr_api_key)"
base="${RADARR_BASE_URL:-http://localhost:7878}"; base="${base%/}"
term="Interstellar"

curl -sS --fail-with-body --get \
  -H "X-Api-Key: $token" \
  "$base/api/v3/movie/lookup" \
  --data-urlencode "term=$term" \
  | jq '.[] | {title, year, tmdbId, imdbId}'
```

Tips:
- Deterministic lookup example: `term="tmdb:157336"` or `term="imdb:tt0816692"`.

### 3) Add a movie from lookup result

```bash
# Inputs you choose:
term="tmdb:157336"
quality_profile_id=1
root_folder_path="/data/media/movies"

# 1) Pick a lookup candidate
candidate="$(
  token="$(resolve_radarr_api_key)";
  base="${RADARR_BASE_URL:-http://localhost:7878}"; base="${base%/}";
  curl -sS --fail-with-body --get \
    -H "X-Api-Key: $token" \
    "$base/api/v3/movie/lookup" \
    --data-urlencode "term=$term" \
  | jq '.[0]'
)"

# 2) Patch library-specific settings
payload="$(jq \
  --arg root "$root_folder_path" \
  --argjson qp "$quality_profile_id" \
  '.qualityProfileId = $qp
   | .rootFolderPath = $root
   | .monitored = true
   | .minimumAvailability = "released"
   | .addOptions = { monitor: "movieOnly", searchForMovie: true }' \
  <<<"$candidate")"

# 3) Add movie
radarr_api POST "/api/v3/movie" "$payload" | jq '{id, title, monitored, path}'
```

### 4) Trigger search for an existing movie

```bash
movie_id=456
payload="$(jq -n --argjson id "$movie_id" '{name:"MoviesSearch", movieIds:[$id]}')"
radarr_api POST "/api/v3/command" "$payload" | jq '{id, name, status, started, ended}'
```

### 5) Calendar, queue, and wanted movies

```bash
# Release calendar in a date window
radarr_api GET "/api/v3/calendar?start=2026-03-03&end=2026-03-17" \
  | jq '.[] | {title, inCinemas, physicalRelease, digitalRelease, minimumAvailability}'

# Active queue
radarr_api GET "/api/v3/queue?page=1&pageSize=20" \
  | jq '{totalRecords, records: [.records[] | {id, title, status, trackedDownloadStatus}]}'

# Wanted missing movies
radarr_api GET "/api/v3/wanted/missing?page=1&pageSize=20" \
  | jq '{totalRecords, records: [.records[] | {id, title, year}]}'
```

### 6) Update or delete an existing movie

```bash
movie_id=456

# Fetch, modify, then PUT back (example: unmonitor)
current="$(radarr_api GET "/api/v3/movie/$movie_id")"
updated="$(jq '.monitored = false' <<<"$current")"
radarr_api PUT "/api/v3/movie/$movie_id" "$updated" | jq '{id, title, monitored}'

# Delete movie files and add import exclusion
radarr_api DELETE "/api/v3/movie/$movie_id?deleteFiles=true&addImportExclusion=true"
```

## Notes

- Radarr accepts API key via header (`X-Api-Key`) or query param (`apikey`); prefer header.
- For adds, use lookup output as the base payload and then patch profile/root/monitor options.
- Common command names include `MoviesSearch` and `MissingMoviesSearch`.
- Keep API keys out of source control and plaintext logs.
