---
name: zotero
description: Manage Zotero libraries via Zotero Web API v3. Use when the user wants to look up items/collections/tags, export citations, or add/update Zotero entries.
---

# Zotero Web API (v3)

Use direct HTTPS requests (`curl` + `jq`) to read and write Zotero libraries.

This skill is for:
- Looking up existing Zotero data (items, collections, tags)
- Adding or updating items and collections
- Exporting formatted citations/bibliographies

## Environment

```bash
# API base and version
export ZOTERO_API_BASE="https://api.zotero.org"
export ZOTERO_API_VERSION="3"

# API key (recommended: 1Password reference)
export ZOTERO_API_KEY="op://Assistant/ZOTERO_API_KEY/credential"
# Optional explicit fallback reference
export ZOTERO_API_KEY_OP_REF="op://Assistant/ZOTERO_API_KEY/credential"

# Library target (choose one approach)
# Preferred explicit form (supports users or groups):
export ZOTERO_LIBRARY_PREFIX="users/<your-user-id>"
# or
export ZOTERO_LIBRARY_PREFIX="groups/<your-group-id>"

# Alternative personal-library shortcut:
export ZOTERO_USER_ID="<your-user-id>"
```

Notes:
- User IDs are numeric and are different from usernames.
- API keys are created in Zotero account settings.
- Never print or commit API keys.

## Reusable shell helpers

```bash
resolve_zotero_api_key() {
  if [ -n "${ZOTERO_API_KEY:-}" ]; then
    if [[ "$ZOTERO_API_KEY" == op://* ]]; then
      op read "$ZOTERO_API_KEY"
    else
      printf '%s' "$ZOTERO_API_KEY"
    fi
    return
  fi

  op read "${ZOTERO_API_KEY_OP_REF:-op://Assistant/ZOTERO_API_KEY/credential}"
}

zotero_library_prefix() {
  if [ -n "${ZOTERO_LIBRARY_PREFIX:-}" ]; then
    printf '%s' "$ZOTERO_LIBRARY_PREFIX"
    return
  fi

  if [ -n "${ZOTERO_USER_ID:-}" ]; then
    printf 'users/%s' "$ZOTERO_USER_ID"
    return
  fi

  echo "Set ZOTERO_LIBRARY_PREFIX (users/<id> or groups/<id>) or ZOTERO_USER_ID" >&2
  return 1
}

zotero_api() {
  local method="$1"
  local path="$2"
  shift 2

  local api_key
  if ! api_key="$(resolve_zotero_api_key)"; then
    echo "Unable to resolve Zotero API key (check op CLI auth / ZOTERO_API_KEY)" >&2
    return 1
  fi

  local base="${ZOTERO_API_BASE:-https://api.zotero.org}"
  local version="${ZOTERO_API_VERSION:-3}"

  curl -sS --fail-with-body -X "$method" \
    -H "Zotero-API-Key: $api_key" \
    -H "Zotero-API-Version: $version" \
    "$@" \
    "$base$path"
}
```

## Read workflows (lookups)

### 1) List collections

```bash
lib="$(zotero_library_prefix)"
zotero_api GET "/$lib/collections" \
  --get \
  --data-urlencode "limit=100" \
  | jq '.[] | {key, name: .data.name, parent: .data.parentCollection}'
```

### 2) Search items by query

```bash
lib="$(zotero_library_prefix)"
query="attention mechanism"

zotero_api GET "/$lib/items" \
  --get \
  --data-urlencode "q=$query" \
  --data-urlencode "qmode=titleCreatorYear" \
  --data-urlencode "sort=dateModified" \
  --data-urlencode "direction=desc" \
  --data-urlencode "limit=20" \
  | jq '.[] | {key, title: .data.title, itemType: .data.itemType, date: .data.date}'
```

Use `qmode=everything` when full-text matching is needed.

### 3) List items in a collection

```bash
lib="$(zotero_library_prefix)"
collection_key="<collection-key>"

zotero_api GET "/$lib/collections/$collection_key/items" \
  --get \
  --data-urlencode "sort=title" \
  --data-urlencode "direction=asc" \
  --data-urlencode "limit=50" \
  | jq '.[] | {key, title: .data.title, itemType: .data.itemType}'
```

### 4) Export a formatted bibliography

```bash
lib="$(zotero_library_prefix)"
collection_key="<collection-key>"

zotero_api GET "/$lib/collections/$collection_key/items" \
  --get \
  --data-urlencode "format=bib" \
  --data-urlencode "style=apa" \
  --data-urlencode "locale=en-US"
```

## Write workflows (adds/updates)

### Write safety rules

- Include `Content-Type: application/json` for JSON writes.
- Prefer `Zotero-Write-Token: <random-32-hex>` for unversioned creates.
- For updates/deletes, include current object version (or `If-Unmodified-Since-Version`) to avoid race conflicts.
- Max 50 objects per create/update/delete multi-object request.

### 1) Create a collection

```bash
lib="$(zotero_library_prefix)"
payload="$(jq -n --arg name "Inbox" '[{name: $name}]')"

zotero_api POST "/$lib/collections" \
  -H "Content-Type: application/json" \
  -H "Zotero-Write-Token: $(openssl rand -hex 16)" \
  -d "$payload" \
  | jq '.'
```

### 2) Create a new item (recommended: start from template)

```bash
lib="$(zotero_library_prefix)"
collection_key="<collection-key>"

# Get valid editable template for the item type
template="$(zotero_api GET "/items/new" --get --data-urlencode "itemType=journalArticle")"

item="$(jq \
  --arg title "Attention Is All You Need" \
  --arg doi "10.48550/arXiv.1706.03762" \
  --arg url "https://arxiv.org/abs/1706.03762" \
  --arg date "2017" \
  --arg ck "$collection_key" \
  '
  .title = $title
  | .DOI = $doi
  | .url = $url
  | .date = $date
  | .creators = [
      {creatorType: "author", firstName: "Ashish", lastName: "Vaswani"},
      {creatorType: "author", firstName: "Noam", lastName: "Shazeer"}
    ]
  | .collections = [$ck]
  ' <<<"$template")"

payload="$(jq -n --argjson item "$item" '[ $item ]')"

zotero_api POST "/$lib/items" \
  -H "Content-Type: application/json" \
  -H "Zotero-Write-Token: $(openssl rand -hex 16)" \
  -d "$payload" \
  | jq '.'
```

### 3) Update an existing item (PATCH)

```bash
lib="$(zotero_library_prefix)"
item_key="<item-key>"

current="$(zotero_api GET "/$lib/items/$item_key")"
item_version="$(jq -r '.version' <<<"$current")"

patch="$(jq -n '{extra: "priority-read"}')"

zotero_api PATCH "/$lib/items/$item_key" \
  -H "Content-Type: application/json" \
  -H "If-Unmodified-Since-Version: $item_version" \
  -d "$patch"
```

Important: in PATCH requests, array fields (`collections`, `creators`, `tags`) are treated as full replacements.

### 4) Delete an item

```bash
lib="$(zotero_library_prefix)"
item_key="<item-key>"
current="$(zotero_api GET "/$lib/items/$item_key")"
item_version="$(jq -r '.version' <<<"$current")"

zotero_api DELETE "/$lib/items/$item_key" \
  -H "If-Unmodified-Since-Version: $item_version"
```

## Practical notes

- The Zotero Web API does not provide one-call DOI/ISBN import like the desktop magic wand. For identifier-based adds, fetch metadata externally (Crossref/OpenAlex/etc.) and map into an `/items/new?itemType=...` template.
- Attachment file uploads use a separate multi-step upload flow (`/items/<key>/file`). Use only when file upload is explicitly requested.
- Handle `429` and `Backoff`/`Retry-After` headers by slowing request rate.
- For library sync-style access, use `since=<libraryVersion>` and `Last-Modified-Version` headers.
