---
name: sonarr
description: Manage Sonarr (TV) with the Sonarr v3 API using curl + jq. Use when the user asks to search/add/update series, inspect queue/calendar, or trigger TV episode searches.
---

# Sonarr (API-first)

Use direct API calls to Sonarr (`/api/v3/...`) with `curl` + `jq`.

## Environment

```bash
# Base URL (optional). If unset, scripts try SONARR_BASE_URL_OP_REF first.
export SONARR_BASE_URL="http://localhost:8989"
# Recommended default fallback reference for base URL:
export SONARR_BASE_URL_OP_REF="op://Assistant/Sonarr/url"

# API key (optional plain value or op:// reference)
export SONARR_API_KEY="op://Assistant/Sonarr/API_KEY"
# Default fallback reference if SONARR_API_KEY is unset:
export SONARR_API_KEY_OP_REF="op://Assistant/Sonarr/API_KEY"
```

Get API key from: `Sonarr -> Settings -> General -> Security -> API Key`

## Reusable shell helpers

```bash
resolve_sonarr_api_key() {
  if [ -n "${SONARR_API_KEY:-}" ]; then
    if [[ "$SONARR_API_KEY" == op://* ]]; then
      op read "$SONARR_API_KEY"
    else
      printf '%s' "$SONARR_API_KEY"
    fi
    return
  fi

  op read "${SONARR_API_KEY_OP_REF:-op://Assistant/Sonarr/API_KEY}"
}

sonarr_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local api_key
  if ! api_key="$(resolve_sonarr_api_key)"; then
    echo "Unable to resolve Sonarr API key (check op CLI auth / SONARR_API_KEY)" >&2
    return 1
  fi

  local base="${SONARR_BASE_URL:-http://localhost:8989}"
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
./scripts/series-lookup.sh "tvdb:81189"

# Add series
./scripts/series-add.sh "tvdb:81189" 1 "/data/media/tv"

# Trigger search and inspect backlog
./scripts/command-series-search.sh 123
./scripts/queue-list.sh 1 20
./scripts/wanted-missing.sh 1 20
```

## Common workflows

### 1) Service, profiles, and root folders

```bash
sonarr_api GET "/api/v3/system/status" | jq '{version, appName, instanceName}'

sonarr_api GET "/api/v3/qualityprofile" | jq '.[] | {id, name}'
sonarr_api GET "/api/v3/rootfolder" | jq '.[] | {id, path, accessible}'
```

### 2) Lookup candidate series

```bash
token="$(resolve_sonarr_api_key)"
base="${SONARR_BASE_URL:-http://localhost:8989}"; base="${base%/}"
term="Breaking Bad"

curl -sS --fail-with-body --get \
  -H "X-Api-Key: $token" \
  "$base/api/v3/series/lookup" \
  --data-urlencode "term=$term" \
  | jq '.[] | {title, year, tvdbId, imdbId, tmdbId}'
```

Tips:
- Lookup by identifier is more deterministic, e.g. `term="tvdb:81189"`.
- Use the selected result to build add payloads.

### 3) Add a series from lookup result

```bash
# Inputs you choose:
term="tvdb:81189"
quality_profile_id=1
root_folder_path="/data/media/tv"

# 1) Grab first lookup candidate
candidate="$(
  token="$(resolve_sonarr_api_key)";
  base="${SONARR_BASE_URL:-http://localhost:8989}"; base="${base%/}";
  curl -sS --fail-with-body --get \
    -H "X-Api-Key: $token" \
    "$base/api/v3/series/lookup" \
    --data-urlencode "term=$term" \
  | jq '.[0]'
)"

# 2) Patch required fields for your library
payload="$(jq \
  --arg root "$root_folder_path" \
  --argjson qp "$quality_profile_id" \
  '.qualityProfileId = $qp
   | .rootFolderPath = $root
   | .seasonFolder = true
   | .monitored = true
   | .addOptions = { monitor: "all", searchForMissingEpisodes: true }' \
  <<<"$candidate")"

# 3) Add series
sonarr_api POST "/api/v3/series" "$payload" | jq '{id, title, monitored, path}'
```

### 4) Trigger a search for an existing series

```bash
series_id=123
payload="$(jq -n --argjson id "$series_id" '{name:"SeriesSearch", seriesId:$id}')"
sonarr_api POST "/api/v3/command" "$payload" | jq '{id, name, status, started, ended}'
```

### 5) Calendar, queue, and wanted episodes

```bash
# Upcoming episodes in date window (YYYY-MM-DD accepted)
sonarr_api GET "/api/v3/calendar?start=2026-03-03&end=2026-03-10&includeSeries=true" \
  | jq '.[] | {airDateUtc, seriesTitle: .series.title, seasonNumber, episodeNumber, title}'

# Active queue
sonarr_api GET "/api/v3/queue?page=1&pageSize=20" \
  | jq '{totalRecords, records: [.records[] | {id, title, status, trackedDownloadStatus}]}'

# Wanted missing episodes
sonarr_api GET "/api/v3/wanted/missing?page=1&pageSize=20" \
  | jq '{totalRecords, records: [.records[] | {seriesId, title, seasonNumber, episodeNumber}]}'
```

### 6) Update or delete an existing series

```bash
series_id=123

# Fetch, modify, then PUT back (example: unmonitor)
current="$(sonarr_api GET "/api/v3/series/$series_id")"
updated="$(jq '.monitored = false' <<<"$current")"
sonarr_api PUT "/api/v3/series/$series_id" "$updated" | jq '{id, title, monitored}'

# Delete series (and files) and optionally exclude from future import-list adds
sonarr_api DELETE "/api/v3/series/$series_id?deleteFiles=true&addImportListExclusion=true"
```

## Notes

- Sonarr accepts API key via header (`X-Api-Key`) or query param (`apikey`); prefer header.
- For adds, using a lookup object as a base avoids missing required model fields.
- Common command names: `SeriesSearch`, `EpisodeSearch`, `SeasonSearch`, `MissingEpisodeSearch`.
- Keep API keys out of source control and plaintext logs.
