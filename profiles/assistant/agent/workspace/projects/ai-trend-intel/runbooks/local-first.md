# Local-first runbook (AI trend intel)

## Local bootstrap

1. `cd /Users/patrick/workingdir/ai-trend-intel`
2. `python3 -m venv .venv`
3. `source .venv/bin/activate`
4. `pip install -r requirements.txt`
5. `pytest -q`

## Local execution

- Ingest:
  - `python -m trendintel.cli ingest --root . --json`
- Analyze:
  - `python -m trendintel.cli analyze --root . --days 7 --json`
- Report:
  - `python -m trendintel.cli report --root . --json`
- One-shot:
  - `python -m trendintel.cli run-all --root . --days 7 --json`

## Determinism check

Run analyze twice for same date and compare hash:

1. `python -m trendintel.cli analyze --root . --days 7 --date YYYY-MM-DD`
2. `shasum data/analysis/trends-YYYY-MM-DD.json`
3. Repeat step 1 and re-check hash.

## Minimum acceptance before deploy

- Tests pass.
- Source coverage looks healthy (no silent source failures).
- Report generated with citations.
- Determinism check passes.

## Unraid deployment policy

- Do **not** deploy first.
- Deploy only after Patrick approves local output quality.
- Prefer a scheduled script/container run with persistent storage in appdata.
