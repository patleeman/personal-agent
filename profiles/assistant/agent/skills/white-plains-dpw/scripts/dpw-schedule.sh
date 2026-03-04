#!/usr/bin/env bash
set -euo pipefail

DEFAULT_AREA_NAME="WhitePlainsNY"
DEFAULT_SERVICE_ID="719"
DEFAULT_LOCALE="en-US"
DEFAULT_ADDRESS="43 Chadwick Road, White Plains, NY 10604"
DEFAULT_DAYS_AHEAD=14

usage() {
  cat <<'EOF'
Usage:
  dpw-schedule.sh [options]

Fetch White Plains DPW collection schedule (trash/recycling/brush/bulk) from the ReCollect API.

Options:
  --address <text>   Address to query (default: 43 Chadwick Road, White Plains, NY 10604)
  --after <date>     Start date, inclusive (YYYY-MM-DD). Default: today
  --before <date>    End date, inclusive (YYYY-MM-DD). Default: today + --days
  --days <int>       Days ahead when --before is omitted (default: 14)
  --json             Emit structured JSON instead of plain text
  -h, --help         Show help

Environment overrides:
  DPW_AREA_NAME      Default: WhitePlainsNY
  DPW_SERVICE_ID     Default: 719
  DPW_LOCALE         Default: en-US

Examples:
  dpw-schedule.sh
  dpw-schedule.sh --days 30
  dpw-schedule.sh --address "43 Chadwick Rd White Plains" --after 2026-03-01 --before 2026-03-31
  dpw-schedule.sh --json
EOF
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: required command '$command_name' is not installed." >&2
    exit 1
  fi
}

is_positive_int() {
  [[ "$1" =~ ^[0-9]+$ ]] && (( "$1" > 0 ))
}

is_iso_date() {
  [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]
}

iso_date_offset() {
  local offset_days="$1"
  python3 - "$offset_days" <<'PY'
import datetime
import sys

offset = int(sys.argv[1])
today = datetime.date.today()
print((today + datetime.timedelta(days=offset)).isoformat())
PY
}

build_address_candidates() {
  local raw_address="$1"
  python3 - "$raw_address" <<'PY'
import re
import sys

raw = sys.argv[1].strip()
if not raw:
    sys.exit(0)

candidates = []

def add_candidate(value: str) -> None:
    normalized = " ".join(value.replace(",", " ").split())
    if normalized and normalized not in candidates:
        candidates.append(normalized)

add_candidate(raw)

without_commas = raw.replace(",", " ")
add_candidate(without_commas)

without_zip = re.sub(r"\b\d{5}(?:-\d{4})?\b", "", without_commas, flags=re.IGNORECASE)
add_candidate(without_zip)

without_state = re.sub(r"\b(?:NY|New York)\b", "", without_zip, flags=re.IGNORECASE)
add_candidate(without_state)

abbreviations = {
    "road": "rd",
    "street": "st",
    "avenue": "ave",
    "drive": "dr",
    "boulevard": "blvd",
    "place": "pl",
    "court": "ct",
    "lane": "ln",
    "circle": "cir",
    "parkway": "pkwy",
    "terrace": "ter",
}

for long_form, short_form in abbreviations.items():
    abbreviated = re.sub(rf"\b{long_form}\b", short_form, without_state, flags=re.IGNORECASE)
    add_candidate(abbreviated)

for candidate in candidates:
    print(candidate)
PY
}

require_command curl
require_command jq
require_command python3

area_name="${DPW_AREA_NAME:-$DEFAULT_AREA_NAME}"
service_id="${DPW_SERVICE_ID:-$DEFAULT_SERVICE_ID}"
locale="${DPW_LOCALE:-$DEFAULT_LOCALE}"
address="$DEFAULT_ADDRESS"
after=""
before=""
days="$DEFAULT_DAYS_AHEAD"
json_output=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --address)
      if [[ $# -lt 2 ]]; then
        echo "Error: --address requires a value." >&2
        exit 1
      fi
      address="$2"
      shift 2
      ;;
    --after)
      if [[ $# -lt 2 ]]; then
        echo "Error: --after requires a value." >&2
        exit 1
      fi
      after="$2"
      shift 2
      ;;
    --before)
      if [[ $# -lt 2 ]]; then
        echo "Error: --before requires a value." >&2
        exit 1
      fi
      before="$2"
      shift 2
      ;;
    --days)
      if [[ $# -lt 2 ]]; then
        echo "Error: --days requires a value." >&2
        exit 1
      fi
      days="$2"
      shift 2
      ;;
    --json)
      json_output=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'." >&2
      usage >&2
      exit 1
      ;;
  esac
done

if ! is_positive_int "$days"; then
  echo "Error: --days must be a positive integer." >&2
  exit 1
fi

if [[ -z "$after" ]]; then
  after="$(iso_date_offset 0)"
fi

if [[ -z "$before" ]]; then
  before="$(iso_date_offset "$days")"
fi

if ! is_iso_date "$after"; then
  echo "Error: --after must be in YYYY-MM-DD format." >&2
  exit 1
fi

if ! is_iso_date "$before"; then
  echo "Error: --before must be in YYYY-MM-DD format." >&2
  exit 1
fi

if [[ "$after" > "$before" ]]; then
  echo "Error: --after must be before or equal to --before." >&2
  exit 1
fi

query_used=""
place_id=""
parcel_id=""
resolved_address=""

while IFS= read -r candidate; do
  [[ -z "$candidate" ]] && continue

  suggestions="$(
    curl -fsS -G "https://api.recollect.net/api/areas/${area_name}/services/${service_id}/address-suggest" \
      --data-urlencode "q=${candidate}" \
      --data-urlencode "locale=${locale}"
  )"

  if [[ "$(printf '%s' "$suggestions" | jq 'length')" -eq 0 ]]; then
    continue
  fi

  query_used="$candidate"
  place_id="$(printf '%s' "$suggestions" | jq -r '.[0].place_id // empty')"
  parcel_id="$(printf '%s' "$suggestions" | jq -r '.[0].parcel_id // empty')"
  resolved_address="$(printf '%s' "$suggestions" | jq -r '.[0].name // empty')"
  break
done < <(build_address_candidates "$address")

if [[ -z "$place_id" ]]; then
  echo "Error: no matching White Plains DPW address found for: $address" >&2
  exit 1
fi

events="$(
  curl -fsS -G "https://api.recollect.net/api/places/${place_id}/services/${service_id}/events" \
    --data-urlencode "nomerge=1" \
    --data-urlencode "locale=${locale}" \
    --data-urlencode "after=${after}" \
    --data-urlencode "before=${before}"
)"

schedule_json="$(
  printf '%s' "$events" | jq '
    [
      .events[]
      | {
          day,
          pickups: ([.flags[]?.subject // empty] | map(select(length > 0)) | unique)
        }
      | select(.pickups | length > 0)
    ]
    | sort_by(.day)
    | group_by(.day)
    | map({
        day: .[0].day,
        pickups: (map(.pickups[]) | unique)
      })
  '
)"

if [[ "$json_output" -eq 1 ]]; then
  jq -n \
    --arg input_address "$address" \
    --arg query_used "$query_used" \
    --arg resolved_address "$resolved_address" \
    --arg place_id "$place_id" \
    --arg parcel_id "$parcel_id" \
    --arg area_name "$area_name" \
    --arg service_id "$service_id" \
    --arg locale "$locale" \
    --arg after "$after" \
    --arg before "$before" \
    --argjson schedule "$schedule_json" \
    '{
      input_address: $input_address,
      query_used: $query_used,
      resolved_address: $resolved_address,
      place_id: $place_id,
      parcel_id: (if $parcel_id == "" then null else ($parcel_id | tonumber?) end),
      area_name: $area_name,
      service_id: $service_id,
      locale: $locale,
      after: $after,
      before: $before,
      schedule: $schedule
    }'
  exit 0
fi

echo "Resolved address: $resolved_address"
echo "Matched query: $query_used"
echo "Date range: $after to $before"

if [[ "$(printf '%s' "$schedule_json" | jq 'length')" -eq 0 ]]; then
  echo "No pickup events found in this window."
  exit 0
fi

printf '%s' "$schedule_json" | jq -r '.[] | "\(.day): \(.pickups | join(", "))"'
