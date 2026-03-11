---
name: hevy
description: Access the Hevy workout app public API using direct HTTP requests (curl + jq). Use when the user wants to fetch, create, or update Hevy workouts/routines, inspect exercise history, or analyze training data stored in Hevy.
---

# Hevy Workout App (API-first)

Use direct HTTP calls only (`curl` + `jq`). This skill is wired to the official Hevy public API as documented at `https://api.hevyapp.com/docs/` (Swagger UI).

Hevy notes from the docs:
- The API is early-stage and may change or be abandoned.
- It is only available to **Hevy Pro** users.
- API keys can be generated at: `https://hevy.com/settings?developer`.

## Environment

Configure your API credentials in shell env:

```bash
# Either set a plain API key...
export HEVY_API_KEY="<hevy-api-key>"      # from https://hevy.com/settings?developer

# ...or (recommended) set an op:// reference
export HEVY_API_KEY="op://Assistant/HEVY_API_KEY/credential"
# Optional override for reference path when HEVY_API_KEY is unset
export HEVY_API_KEY_OP_REF="op://Assistant/HEVY_API_KEY/credential"

export HEVY_API_BASE="https://api.hevyapp.com"  # default base URL
```

Auth, per the OpenAPI spec:
- All endpoints require a header **`api-key`** (not `Authorization`).
- Type is a UUID-like string.

Security rules:
- Never print `HEVY_API_KEY` directly in commands or logs.
- Do not commit the key or any secrets to git.

## Helper function

Use this shell helper for repeatable calls (with 1Password support):

```bash
resolve_hevy_api_key() {
  if [ -n "${HEVY_API_KEY:-}" ]; then
    if [[ "$HEVY_API_KEY" == op://* ]]; then
      op read "$HEVY_API_KEY"
    else
      printf '%s' "$HEVY_API_KEY"
    fi
    return
  fi

  op read "${HEVY_API_KEY_OP_REF:-op://Assistant/HEVY_API_KEY/credential}"
}

hevy_api() {
  local method="$1"   # GET, POST, PUT, etc.
  local path="$2"     # e.g. "/v1/workouts"
  local data="${3:-}" # optional JSON payload

  local api_key
  if ! api_key="$(resolve_hevy_api_key)"; then
    echo "Unable to resolve Hevy API key (check op CLI auth / HEVY_API_KEY)" >&2
    return 1
  fi

  local base="${HEVY_API_BASE:-https://api.hevyapp.com}"

  if [ -n "$data" ]; then
    curl -sS -X "$method" \
      -H "api-key: $api_key" \
      -H "Content-Type: application/json" \
      "$base$path" \
      -d "$data"
  else
    curl -sS -X "$method" \
      -H "api-key: $api_key" \
      "$base$path"
  fi
}
```

---

## Core endpoints

From `swagger-ui-init.js`:

- Workouts
  - `GET  /v1/workouts` – paginated list of workouts (`page`, `pageSize` up to 10)
  - `POST /v1/workouts` – create a new workout
  - `GET  /v1/workouts/{workoutId}` – full details for a workout
  - `PUT  /v1/workouts/{workoutId}` – update an existing workout
  - `GET  /v1/workouts/count` – total number of workouts for the account
  - `GET  /v1/workouts/events` – paged list of workout events (updates/deletes) with `since` filter

- Users
  - `GET /v1/user/info` – authenticated user info

- Routines
  - `GET  /v1/routines` – paginated list of routines
  - `POST /v1/routines` – create a routine
  - `GET  /v1/routines/{routineId}` – get routine details
  - `PUT  /v1/routines/{routineId}` – update routine

- Exercise templates
  - `GET  /v1/exercise_templates` – paginated list of exercise templates
  - `POST /v1/exercise_templates` – create a custom exercise template
  - `GET  /v1/exercise_templates/{exerciseTemplateId}` – get a template

- Routine folders
  - `GET  /v1/routine_folders` – paginated list of routine folders
  - `POST /v1/routine_folders` – create a routine folder
  - `GET  /v1/routine_folders/{folderId}` – get a folder

- Exercise history
  - `GET /v1/exercise_history/{exerciseTemplateId}` – history for a given exercise template, optional `start_date`/`end_date` (ISO 8601)

The schemas referenced below are from `components.schemas` in the Hevy OpenAPI spec.

---

## Common workflows

### 1) Sanity-check auth / get user info

```bash
hevy_api GET "/v1/user/info" | jq '.'
```

If this returns JSON (and not an auth error), the key is valid.

### 2) List recent workouts

`GET /v1/workouts` returns a paginated object:

```json
{
  "page": 1,
  "page_count": 5,
  "workouts": [ /* Workout[] */ ]
}
```

Example: list the most recent page of workouts with basic info:

```bash
hevy_api GET "/v1/workouts?page=1&pageSize=5" \
  | jq '.workouts[] | {id, title: .workout.title, start: .workout.start_time, end: .workout.end_time}'
```

Adjust `pageSize` (max 10 according to docs) as needed.

### 3) Get details for a single workout

```bash
workout_id="<workout-id>"
hevy_api GET "/v1/workouts/$workout_id" | jq '.'
```

The response schema is `Workout` (see Swagger), which includes the workout metadata and nested exercises/sets.

### 4) Create a workout (real schema)

The `POST /v1/workouts` body is `PostWorkoutsRequestBody`:

```json
{
  "workout": {
    "title": "...",
    "description": "...",
    "start_time": "2024-08-14T12:00:00Z",
    "end_time": "2024-08-14T12:30:00Z",
    "is_private": false,
    "exercises": [
      {
        "exercise_template_id": "D04AC939",
        "superset_id": null,
        "notes": "...",
        "sets": [
          {
            "type": "normal",
            "weight_kg": 100,
            "reps": 10,
            "distance_meters": null,
            "duration_seconds": null,
            "custom_metric": null,
            "rpe": null
          }
        ]
      }
    ]
  }
}
```

Example `curl` via the helper:

```bash
payload=$(jq -n \
  --arg title "Friday Leg Day 🔥" \
  --arg desc "Medium intensity leg day focusing on quads." \
  --arg start "2024-08-14T12:00:00Z" \
  --arg end   "2024-08-14T12:30:00Z" \
  --arg ex_tmpl "D04AC939" \
  '{
    workout: {
      title: $title,
      description: $desc,
      start_time: $start,
      end_time: $end,
      is_private: false,
      exercises: [
        {
          exercise_template_id: $ex_tmpl,
          superset_id: null,
          notes: "Felt good today.",
          sets: [
            {
              type: "normal",
              weight_kg: 100,
              reps: 5,
              distance_meters: null,
              duration_seconds: null,
              custom_metric: null,
              rpe: 8
            }
          ]
        }
      ]
    }
  }')

hevy_api POST "/v1/workouts" "$payload" | jq '.'
```

You can build more complex workouts by adding more exercises and sets.

### 5) Update / delete a workout

Update uses the same `PostWorkoutsRequestBody` schema via `PUT /v1/workouts/{workoutId}`:

```bash
workout_id="<workout-id>"
update_payload=$(jq -n \
  --arg title "Upper Body A" \
  '{ workout: { title: $title } }')

hevy_api PUT "/v1/workouts/$workout_id" "$update_payload" | jq '.'
```

Count workouts:

```bash
hevy_api GET "/v1/workouts/count" | jq '.'
```

Events for sync (updates/deletes) via `GET /v1/workouts/events`:

```bash
hevy_api GET "/v1/workouts/events?page=1&pageSize=5&since=2024-01-01T00:00:00Z" \
  | jq '.workout_events'
```

The response schema is `PaginatedWorkoutEvents`.

### 6) Routines

`GET /v1/routines` returns paginated routines:

```bash
hevy_api GET "/v1/routines?page=1&pageSize=5" \
  | jq '.routines[] | {id, title: .routine.title}'
```

Create a routine via `POST /v1/routines` with `PostRoutinesRequestBody`:

```bash
routine_payload=$(jq -n \
  --arg title "Push Day" \
  --arg ex_tmpl "D04AC939" \
  '{
    routine: {
      title: $title,
      exercises: [
        {
          exercise_template_id: $ex_tmpl,
          superset_id: null,
          rest_seconds: 90,
          notes: "Stay slow and controlled.",
          sets: [
            { type: "normal", weight_kg: 60, reps: 10 },
            { type: "normal", weight_kg: 60, reps: 8 }
          ]
        }
      ]
    }
  }')

hevy_api POST "/v1/routines" "$routine_payload" | jq '.'
```

Get/update a routine:

```bash
routine_id="<routine-id>"
hevy_api GET "/v1/routines/$routine_id" | jq '.'
# PUT /v1/routines/{routineId} uses PutRoutinesRequestBody (similar shape)
```

### 7) Exercise templates

List exercise templates (built-in + custom) via `GET /v1/exercise_templates`:

```bash
hevy_api GET "/v1/exercise_templates?page=1&pageSize=20" \
  | jq '.exercise_templates[] | {id, name: .name}'
```

Create a custom exercise template via `POST /v1/exercise_templates` with `CreateCustomExerciseRequestBody`:

```bash
exercise_payload=$(jq -n \
  --arg name "Trap Bar Deadlift" \
  '{name: $name}')

# Add any other CreateCustomExerciseRequestBody fields required by the API version
# or account setup before POSTing.
hevy_api POST "/v1/exercise_templates" "$exercise_payload" | jq '.'
```

Get a specific template:

```bash
exercise_template_id="D04AC939"
hevy_api GET "/v1/exercise_templates/$exercise_template_id" | jq '.'
```

### 8) Exercise history

Use `GET /v1/exercise_history/{exerciseTemplateId}` to pull history for one exercise template, with optional date filters:

```bash
exercise_template_id="D04AC939"
hevy_api GET "/v1/exercise_history/$exercise_template_id?start_date=2024-01-01T00:00:00Z&end_date=2024-12-31T23:59:59Z" \
  | jq '.exercise_history'
```

This returns an object with `exercise_history: ExerciseHistoryEntry[]`.

---

## Notes

- All examples assume macOS/Linux shell with `curl` and `jq` installed.
- Use `jq -n` to build payloads; avoid hand-written JSON with unescaped quotes.
- Pagination is consistently `page` + `pageSize` (with max values per endpoint).
- Keep `HEVY_API_KEY` and any sensitive info out of source control, AGENTS.md, and skills.
