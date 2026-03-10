---
name: dd-gitlab-ci
description: Use when asked to investigate GitLab CI pipeline failures, fetch job logs, debug CI errors, or do root cause analysis on failed pipelines at gitlab.ddbuild.io. Triggers on GitLab pipeline URLs, CI failure questions, or "why did my pipeline fail?".
---

# Datadog GitLab CI

Investigate CI pipeline failures, fetch job logs, and do root cause analysis on gitlab.ddbuild.io.

## Prerequisites

Get a GitLab token:
```bash
export GITLAB_TOKEN=$(ddtool auth gitlab token)
```

If token is expired: `ddtool auth gitlab login` (browser OAuth flow).

## API Base

All endpoints use: `https://gitlab.ddbuild.io/api/v4`

Header: `-H "PRIVATE-TOKEN: ${GITLAB_TOKEN}"`

Project IDs use URL-encoded paths (e.g., `DataDog%2Fdd-source`).

## Common Operations

### Get Pipeline Details
```bash
GITLAB_TOKEN=$(ddtool auth gitlab token)
curl -s "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2Fdd-source/pipelines/<pipeline_id>" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '{id, status, ref, created_at, web_url}'
```

### List Pipeline Jobs (find the failed ones)
```bash
curl -s "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2Fdd-source/pipelines/<pipeline_id>/jobs?per_page=100" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '.[] | select(.status == "failed") | {id, name, stage, status, web_url}'
```

### Get Job Log
```bash
curl -s "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2Fdd-source/jobs/<job_id>/trace" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | tail -100
```

Job logs are plain text. The last 100 lines usually contain the error. Fetch more with `tail -500` if needed.

### Get Job Details
```bash
curl -s "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2Fdd-source/jobs/<job_id>" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '{id, name, stage, status, duration, started_at, finished_at, failure_reason, web_url}'
```

### Get Merge Request
```bash
curl -s "https://gitlab.ddbuild.io/api/v4/projects/DataDog%2Fdd-source/merge_requests/<mr_iid>" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '{title, state, author: .author.username, web_url}'
```

## RCA Workflow for Pipeline Failures

**Pipeline metadata rarely explains the failure on its own; fetch the failed job logs.**

### Step 1: Get pipeline overview + failed jobs (parallel)
Run both simultaneously:
```bash
GITLAB_TOKEN=$(ddtool auth gitlab token)

# Pipeline overview
curl -s "https://gitlab.ddbuild.io/api/v4/projects/<project>/pipelines/<pipeline_id>" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '{status, ref, web_url}'

# Failed jobs
curl -s "https://gitlab.ddbuild.io/api/v4/projects/<project>/pipelines/<pipeline_id>/jobs?per_page=100" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | jq '[.[] | select(.status == "failed") | {id, name, stage}]'
```

### Step 2: Fetch all failed job logs in parallel
For each failed job, fetch the log:
```bash
curl -s "https://gitlab.ddbuild.io/api/v4/projects/<project>/jobs/<job_id>/trace" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" | tail -100
```

### Step 3: Report the actual error
Include the error message from the logs, not just "it failed".

## Parsing Pipeline URLs

GitLab URLs follow these patterns:
- Pipeline: `https://gitlab.ddbuild.io/DataDog/dd-source/-/pipelines/91687881`
- Job: `https://gitlab.ddbuild.io/DataDog/dd-source/-/jobs/1353289006`
- MR: `https://gitlab.ddbuild.io/DataDog/dd-source/-/merge_requests/12345`

Extract the project path and ID from the URL. URL-encode the project path for API calls (`DataDog/dd-source` → `DataDog%2Fdd-source`).

## Common Failure Patterns

| Pattern | Look For |
|---------|----------|
| **Test failures** | `FAIL`, `FAILED`, `AssertionError`, test names |
| **Build failures** | `error:`, `cannot find`, `undefined reference` |
| **Timeout** | `Job exceeded time limit`, `deadline exceeded` |
| **Linter errors** | `lint`, `golangci-lint`, `flake8` |
| **Deploy failures** | `permission denied`, `unauthorized`, `rollback` |
| **OOM** | `killed`, `Out of memory`, `OOMKilled` |

## Response Format

```
## Pipeline #[id] — [FAILED/PASSED]
- **Branch:** [ref]
- **URL:** [web_url]

### Failed Jobs
1. **[job_name]** (stage: [stage])
   - **Error:** [actual error message from logs]
   - **Job URL:** [url]

### Root Cause
[Analysis based on the error messages]

### Suggested Fix
[If determinable from the error]
```
