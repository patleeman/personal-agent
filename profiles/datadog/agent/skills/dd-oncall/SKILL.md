---
name: dd-oncall
description: Use when asked about Datadog on-call schedules, finding who's on-call for a team or service, investigating on-call pages/alerts, or doing root cause analysis on on-call pages. Triggers on questions like "who's on-call?", "investigate this page", "what triggered this alert?", or on-call page URLs.
---

# Datadog On-Call

Query on-call schedules, find who's currently on-call, and investigate on-call pages using the Datadog API via `dd-auth` and `curl`.

## Prerequisites

Ensure Datadog API credentials are available:
```bash
eval $(dd-auth env)
# Provides: DD_API_KEY, DD_APP_KEY, DD_SITE
```

## API Base

All endpoints use: `https://api.${DD_SITE}/api`

Headers for all requests:
```bash
-H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" -H "Content-Type: application/json"
```

## Common Workflows

### 1. Who's On-Call for a Team?

**Step 1:** Find the team ID:
```bash
eval $(dd-auth env)
curl -s "https://api.${DD_SITE}/api/v2/team" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" \
  --data-urlencode "filter[keyword]=<team-name>" | jq '.data[] | {id, name: .attributes.name}'
```

**Step 2:** Get on-call schedules for that team:
```bash
curl -s "https://api.${DD_SITE}/api/v2/on-call/schedules?filter[team_id]=<team_id>" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq .
```

**Step 3:** Get current on-call user for a schedule:
```bash
curl -s "https://api.${DD_SITE}/api/v2/on-call/schedules/<schedule_id>/on-call" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq .
```

### 2. Who's On-Call for a Service?

**Step 1:** Find the service's owning team via Software Catalog:
```bash
eval $(dd-auth env)
curl -s "https://api.${DD_SITE}/api/v2/catalog/entity?filter[name]=<service-name>&filter[kind]=service" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq '.data[].attributes.owner'
```

**Step 2:** Extract team name from owner (e.g., `team:my-team`), then follow the team workflow above.

### 3. Investigate an On-Call Page

Extract page ID from URLs like: `https://app.datadoghq.com/on-call/pages/1126422`

```bash
eval $(dd-auth env)
curl -s "https://api.${DD_SITE}/api/v2/on-call/pages/<page_id>" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq .
```

**Key fields in page response:**
- `description` — Error context, pipeline name, CI URL
- `author` — What triggered the page:
  - `monitors` → has `monitor_id`, `alert_url`
  - `events` → has `source_type_name`, `integration_id`
  - `incident_authors` → has `incident_uuid`
- `services` — Affected services
- `status` — triggered, acknowledged, resolved

### 4. List Recent Pages for a Team

```bash
eval $(dd-auth env)
curl -s "https://api.${DD_SITE}/api/v2/on-call/pages?query=team:(<team-name>)&page[size]=10" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq .
```

## Root Cause Analysis Workflow

When investigating an on-call page:

1. **Fetch the page** (see above)
2. **Identify the trigger type** from the `author` field
3. **Investigate based on trigger:**

**Monitor-triggered:**
```bash
# Fetch monitor details
curl -s "https://api.${DD_SITE}/api/v1/monitor/<monitor_id>" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq '{name, status, query, message}'
```

**CI/Pipeline-triggered:** If description contains a GitLab URL, use the `dd-gitlab-ci` skill to fetch job logs.

**Incident-triggered:**
```bash
curl -s "https://api.${DD_SITE}/api/v2/incidents/<incident_id>" \
  -H "DD-API-KEY: ${DD_API_KEY}" -H "DD-APPLICATION-KEY: ${DD_APP_KEY}" | jq .
```

4. **Run parallel queries** — always gather monitor details, recent logs, and metrics simultaneously.

## Response Format

**Who's On-Call:**
```
## On-Call: [Team Name]
- **Primary:** [Name] ([Email]) — until [end_time]
- **Secondary:** [Name] ([Email]) — until [end_time]
- **Schedule:** [Schedule Name]
```

**Page Investigation:**
```
## On-Call Page #[page_id]
- **Status:** [triggered/acknowledged/resolved]
- **Triggered:** [timestamp]
- **Source:** [monitor/event/incident] — [name/ID]
- **Affected Services:** [list]
- **Description:** [content]
```
