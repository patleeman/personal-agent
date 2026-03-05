#!/usr/bin/env bash
set -euo pipefail

ROOT="${NOTES_ROOT:-$HOME/Library/CloudStorage/Dropbox/Notes}"

if [[ ! -d "$ROOT" ]]; then
  echo "Error: notes root not found: $ROOT" >&2
  exit 1
fi

python3 - "$ROOT" <<'PY'
from pathlib import Path
from collections import Counter
import sys

root = Path(sys.argv[1])

entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
files = 0
dirs = 0
ext = Counter()
per_top = Counter()

for p in root.rglob('*'):
    if p.is_dir():
        dirs += 1
        continue
    if not p.is_file():
        continue

    files += 1
    ext[p.suffix.lower() or '<no_ext>'] += 1
    rel = p.relative_to(root)
    top = rel.parts[0] if rel.parts else '.'
    per_top[top] += 1

print(f"Notes root: {root}")
print(f"Top-level entries: {len(entries)}")
print(f"Recursive totals: {dirs} directories, {files} files")

print("\nTop-level entries:")
for p in entries:
    kind = 'dir ' if p.is_dir() else 'file'
    print(f"- {kind} {p.name}")

print("\nTop file extensions:")
for e, c in ext.most_common(12):
    print(f"- {e}: {c}")

print("\nTop-level file counts:")
for k, c in per_top.most_common(15):
    print(f"- {k}: {c}")
PY
