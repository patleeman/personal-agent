---
name: overseerr
description: Manage Overseerr via its API (search, create/list/approve requests, inspect movie/TV status). Use when the user asks to request media or administer requests in Overseerr.
---

# Overseerr (API-first)

Use direct HTTPS requests (`curl` + `jq`) against Overseerr's API.

Based on Overseerr's OpenAPI (`overseerr-api.yml`):
- Base path is `/<...>/api/v1`
- Auth supports `X-Api-Key` (preferred for automation) or cookie sessions

## Environment

```bash
# Base URL (optional). If unset, scripts try OVERSEERR_BASE_URL_OP_REF first.
export OVERSEERR_BASE_URL="http://localhost:5055"
# Recommended default fallback reference for base URL:
export OVERSEERR_BASE_URL_OP_REF="op://Assistant/Overseerr/url"

# API key (optional plain value or op:// reference)
export OVERSEERR_API_KEY="op://Assistant/Overseerr/API_KEY"
# Default fallback reference if OVERSEERR_API_KEY is unset:
export OVERSEERR_API_KEY_OP_REF="op://Assistant/Overseerr/API_KEY"
```

Get API key from: `Overseerr -> Settings -> General -> API Key`

## Reusable shell helpers

```bash
resolve_overseerr_api_key() {
  if [ -n "${OVERSEERR_API_KEY:-}" ]; then
    if [[ "$OVERSEERR_API_KEY" == op://* ]]; then
      op read "$OVERSEERR_API_KEY"
    else
      printf '%s' "$OVERSEERR_API_KEY"
    fi
    return
  fi

  op read "${OVERSEERR_API_KEY_OP_REF:-op://Assistant/Overseerr/API_KEY}"
}

overseerr_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local api_key
  if ! api_key="$(resolve_overseerr_api_key)"; then
    echo "Unable to resolve Overseerr API key (check op CLI auth / OVERSEERR_API_KEY)" >&2
    return 1
  fi

  local base="${OVERSEERR_BASE_URL:-http://localhost:5055}"
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
./scripts/api.sh GET /api/v1/status

# Health + auth
./scripts/status.sh
./scripts/auth-me.sh

# Search
./scripts/search.sh "The Matrix"

# Create requests
./scripts/request-create.sh movie 603
./scripts/request-create.sh tv 1399 all
./scripts/request-create.sh tv 1399 1,2

# List/manage requests
./scripts/request-list.sh pending 20 0 added
./scripts/request-set-status.sh 123 approve
./scripts/request-set-status.sh 123 decline
./scripts/request-set-status.sh 123 retry
```

## Common workflows

### 1) Service and auth checks

```bash
base="${OVERSEERR_BASE_URL:-http://localhost:5055}"; base="${base%/}"

# Public health/status endpoint
curl -sS --fail-with-body "$base/api/v1/status" | jq '{version, commitTag, totalRequests}'

# Auth sanity-check
overseerr_api GET "/api/v1/auth/me" | jq '{id, email, permissions}'
```

### 2) Search media

```bash
token="$(resolve_overseerr_api_key)"
base="${OVERSEERR_BASE_URL:-http://localhost:5055}"; base="${base%/}"
query="The Matrix"

curl -sS --fail-with-body --get \
  -H "X-Api-Key: $token" \
  "$base/api/v1/search" \
  --data-urlencode "query=$query" \
  | jq '.results[] | {mediaType, id, title, name, releaseDate, firstAirDate}'
```

Notes:
- `id` in search results is TMDB ID.
- Use `mediaType` (`movie` or `tv`) when creating requests.

### 3) Inspect movie/TV status before requesting

```bash
# Movie details by TMDB ID
movie_tmdb_id=603
overseerr_api GET "/api/v1/movie/$movie_tmdb_id" | jq '{id, title, mediaInfo, request}'

# TV details by TMDB ID
tv_tmdb_id=1399
overseerr_api GET "/api/v1/tv/$tv_tmdb_id" | jq '{id, name, mediaInfo, request}'
```

### 4) Create requests

Movie request:

```bash
movie_tmdb_id=603
payload="$(jq -n --argjson mediaId "$movie_tmdb_id" '{mediaType:"movie", mediaId:$mediaId}')"
overseerr_api POST "/api/v1/request" "$payload" | jq '{id, status, media}'
```

TV request (all seasons):

```bash
tv_tmdb_id=1399
payload="$(jq -n --argjson mediaId "$tv_tmdb_id" '{mediaType:"tv", mediaId:$mediaId, seasons:"all"}')"
overseerr_api POST "/api/v1/request" "$payload" | jq '{id, status, media}'
```

TV request (specific seasons):

```bash
tv_tmdb_id=1399
payload="$(jq -n --argjson mediaId "$tv_tmdb_id" '{mediaType:"tv", mediaId:$mediaId, seasons:[1,2]}')"
overseerr_api POST "/api/v1/request" "$payload"
```

### 5) List and filter requests

```bash
# Filter options include: all, approved, available, pending, processing, unavailable, failed, deleted, completed.
overseerr_api GET "/api/v1/request?take=20&skip=0&filter=pending&sort=added" \
  | jq '{pageInfo, results: [.results[] | {id, type, status, requestedBy: .requestedBy.displayName, media}]}'
```

### 6) Approve, decline, delete, retry requests

```bash
request_id=123

# Approve
overseerr_api POST "/api/v1/request/$request_id/approve" | jq '{id, status}'

# Decline
overseerr_api POST "/api/v1/request/$request_id/decline" | jq '{id, status}'

# Retry a failed request
overseerr_api POST "/api/v1/request/$request_id/retry" | jq '{id, status}'

# Delete request
overseerr_api DELETE "/api/v1/request/$request_id"
```

## Notes

- For automation, prefer API key auth (`X-Api-Key`) over cookie flows.
- `POST /api/v1/request` supports advanced fields (`serverId`, `profileId`, `rootFolder`, etc.) when needed.
- Keep API keys out of repo files, AGENTS.md, and plaintext logs.
