#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  notes-find.sh <query> [--include-archive] [--limit N]

Environment:
  NOTES_ROOT  Optional override (default: ~/Library/CloudStorage/Dropbox/Notes)

Behavior:
  - Searches Markdown files only
  - Excludes .obsidian and .trash
  - Excludes !Archive unless --include-archive is set
EOF
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 1
fi

ROOT="${NOTES_ROOT:-$HOME/Library/CloudStorage/Dropbox/Notes}"
if [[ ! -d "$ROOT" ]]; then
  echo "Error: notes root not found: $ROOT" >&2
  exit 1
fi

QUERY=""
INCLUDE_ARCHIVE=0
LIMIT=30

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-archive)
      INCLUDE_ARCHIVE=1
      shift
      ;;
    --limit)
      LIMIT="${2:-}"
      if [[ -z "$LIMIT" ]]; then
        echo "Error: --limit requires a value" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$QUERY" ]]; then
        QUERY="$1"
      else
        QUERY="$QUERY $1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "Error: query is required" >&2
  exit 1
fi

if ! [[ "$LIMIT" =~ ^[0-9]+$ ]] || [[ "$LIMIT" -lt 1 ]]; then
  echo "Error: --limit must be a positive integer" >&2
  exit 1
fi

python3 - "$ROOT" "$QUERY" "$INCLUDE_ARCHIVE" "$LIMIT" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
query = sys.argv[2].lower()
include_archive = sys.argv[3] == '1'
limit = int(sys.argv[4])

skip_dirs = {'.obsidian', '.trash'}
results = []

for p in root.rglob('*.md'):
    rel = p.relative_to(root)
    parts = rel.parts

    if any(part in skip_dirs for part in parts):
        continue
    if not include_archive and parts and parts[0] == '!Archive':
        continue

    rel_text = str(rel)

    # Filename/path match fallback (works even when cloud file contents are not locally hydrated)
    if query in rel_text.lower():
        results.append((rel_text, '-', '[path match]'))
        if len(results) >= limit:
            break

    try:
        text = p.read_text(encoding='utf-8', errors='replace')
    except Exception:
        continue

    for idx, line in enumerate(text.splitlines(), start=1):
        if query in line.lower():
            snippet = line.strip()
            if len(snippet) > 180:
                snippet = snippet[:177] + '...'
            results.append((rel_text, idx, snippet))
            if len(results) >= limit:
                break

    if len(results) >= limit:
        break

if not results:
    print('No matches found.')
    raise SystemExit(0)

for rel, ln, snippet in results:
    print(f"{rel}:{ln}\t{snippet}")
PY
