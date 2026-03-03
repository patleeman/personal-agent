---
name: todoist
description: Manage Todoist tasks and lists using direct Todoist REST API calls (curl + jq). Use when the user asks to add/list/update/complete tasks, or manage Todoist projects/sections.
---

# Todoist (API-first)

Use direct HTTP requests to the Todoist REST API.

## Setup

```bash
# Either set a plain token...
export TODOIST_API_TOKEN="<todoist-api-token>"

# ...or (recommended) set an op:// reference
export TODOIST_API_TOKEN="op://Assistant/TODOIST_API_TOKEN/credential"
# Optional override for reference path when TODOIST_API_TOKEN is unset
export TODOIST_API_TOKEN_OP_REF="op://Assistant/TODOIST_API_TOKEN/credential"

export TODOIST_API_BASE="https://api.todoist.com/api/v1"
```

Get token from: `https://todoist.com/app/settings/integrations`

## Reusable helper

Use this shell helper in commands (with 1Password support):

```bash
resolve_todoist_api_token() {
  if [ -n "${TODOIST_API_TOKEN:-}" ]; then
    if [[ "$TODOIST_API_TOKEN" == op://* ]]; then
      op read "$TODOIST_API_TOKEN"
    else
      printf '%s' "$TODOIST_API_TOKEN"
    fi
    return
  fi

  op read "${TODOIST_API_TOKEN_OP_REF:-op://Assistant/TODOIST_API_TOKEN/credential}"
}

todoist_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local token
  if ! token="$(resolve_todoist_api_token)"; then
    echo "Unable to resolve Todoist API token (check op CLI auth / TODOIST_API_TOKEN)" >&2
    return 1
  fi

  local base="${TODOIST_API_BASE:-https://api.todoist.com/api/v1}"

  if [ -n "$data" ]; then
    curl -sS -X "$method" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      "$base$path" \
      -d "$data"
  else
    curl -sS -X "$method" \
      -H "Authorization: Bearer $token" \
      "$base$path"
  fi
}
```

Sanity check auth:

```bash
todoist_api GET "/projects" | jq '.results[0:]'
```

## Common workflows

### 1) List projects (Todoist "lists")

```bash
todoist_api GET "/projects" | jq '.results[] | {id, name, color, is_favorite}'
```

### 2) Create / update / delete a project

```bash
# Create
payload=$(jq -n --arg name "Personal Admin" '{name: $name}')
todoist_api POST "/projects" "$payload" | jq '{id, name}'

# Rename (POST /projects/{id})
project_id="<project-id>"
payload=$(jq -n --arg name "Personal" '{name: $name}')
todoist_api POST "/projects/$project_id" "$payload"

# Delete (returns 204)
token="$(resolve_todoist_api_token)"
base="${TODOIST_API_BASE:-https://api.todoist.com/api/v1}"
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X DELETE \
  -H "Authorization: Bearer $token" \
  "$base/projects/$project_id"
```

### 3) List tasks

```bash
# All active tasks
todoist_api GET "/tasks" | jq '.results[] | {id, content, project_id, priority, due}'

# By natural-language filter (today, overdue, etc.)
token="$(resolve_todoist_api_token)"
base="${TODOIST_API_BASE:-https://api.todoist.com/api/v1}"
curl -sS --get \
  -H "Authorization: Bearer $token" \
  "$base/tasks" \
  --data-urlencode "filter=today | overdue" \
  | jq '.results[] | {id, content, due}'

# By project_id
project_id="<project-id>"
curl -sS --get \
  -H "Authorization: Bearer $token" \
  "$base/tasks" \
  --data-urlencode "project_id=$project_id" \
  | jq '.results[] | {id, content, priority, due}'
```

### 4) Add a task

```bash
payload=$(jq -n \
  --arg content "Buy milk" \
  --arg due "tomorrow 6pm" \
  --argjson priority 3 \
  '{content: $content, due_string: $due, priority: $priority}')

todoist_api POST "/tasks" "$payload" | jq '{id, content, priority, due}'
```

Add task to a project:

```bash
payload=$(jq -n \
  --arg content "Plan week" \
  --arg project_id "$project_id" \
  '{content: $content, project_id: $project_id}')

todoist_api POST "/tasks" "$payload" | jq '{id, content, project_id}'
```

### 5) Update / complete / reopen / delete a task

```bash
task_id="<task-id>"

# Update task fields (POST /tasks/{id})
payload=$(jq -n --arg content "Buy oat milk" --argjson priority 2 '{content: $content, priority: $priority}')
todoist_api POST "/tasks/$task_id" "$payload"

token="$(resolve_todoist_api_token)"
base="${TODOIST_API_BASE:-https://api.todoist.com/api/v1}"

# Complete task (close)
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $token" \
  "$base/tasks/$task_id/close"

# Reopen task
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST \
  -H "Authorization: Bearer $token" \
  "$base/tasks/$task_id/reopen"

# Delete task
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X DELETE \
  -H "Authorization: Bearer $token" \
  "$base/tasks/$task_id"
```

### 6) Manage sections inside a project

```bash
# List sections in a project
token="$(resolve_todoist_api_token)"
base="${TODOIST_API_BASE:-https://api.todoist.com/api/v1}"
curl -sS --get \
  -H "Authorization: Bearer $token" \
  "$base/sections" \
  --data-urlencode "project_id=$project_id" \
  | jq '.results[] | {id, name, project_id, order}'

# Create section
payload=$(jq -n --arg name "This Week" --arg project_id "$project_id" '{name: $name, project_id: $project_id}')
todoist_api POST "/sections" "$payload" | jq '{id, name, project_id}'
```

## Notes

- Prefer `jq -n` to build JSON payloads safely (avoid quoting bugs).
- Todoist IDs are strings; keep them quoted in payloads.
- For create calls, you can add `-H "X-Request-Id: $(uuidgen)"` to avoid accidental duplicates on retries.
- Successful update/delete/close/reopen usually return HTTP `204` with empty body.
