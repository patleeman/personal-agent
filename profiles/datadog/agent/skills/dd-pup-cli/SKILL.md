---
name: dd-pup-cli
description: Use when asked to query Datadog APIs — monitors, logs, metrics, dashboards, incidents, SLOs, hosts, traces, software catalog, or any Datadog platform data. Also use for charting/graphing Datadog metrics or logs.
---

# Datadog API via pup CLI

Query any Datadog data using `pup`, a Go-based CLI wrapper for Datadog APIs.

## Authentication

pup supports OAuth2 (recommended) or API keys.

Check the actual auth state first:

```bash
pup auth status --output table
```

If not authenticated:
```bash
pup auth login
pup auth login --agent  # Better for agent-driven CLI flows
```

`pup test` is still useful for confirming site/output settings, but it may show API keys as unset even when OAuth2 is the intended auth path, so do not treat that alone as an auth failure.

## Output Formats

All commands support: `--output json` (default), `--output table`, `--output yaml`

Pipe JSON output through `jq` for filtering.

## Command Reference

### Monitors

```bash
pup monitors list
pup monitors list --name="CPU"
pup monitors list --tags="env:production,team:backend"
pup monitors get 12345678
```

### Logs

```bash
# Search logs (v1)
pup logs search --query="status:error" --from="1h"

# Query logs (v2)
pup logs query --query="service:web-app" --from="4h" --to="now"

# Aggregate logs
pup logs aggregate --query="*" --compute="count" --group-by="status"
```

Log query syntax: `status:error`, `service:web-app`, `@user.id:12345`, `host:i-*`, `"exact phrase"`, `AND`, `OR`, `NOT`

Time ranges: relative (`1h`, `30m`, `7d`, `1w`), absolute (unix ms), or `now`

### Metrics

```bash
pup metrics query --query="avg:system.cpu.user{*}" --from="1h" --to="now"
pup metrics query --query="sum:app.requests{env:prod} by {service}" --from="4h"
pup metrics list
pup metrics list --filter="system.*"
pup metrics metadata get system.cpu.user
```

### APM Services / Traces

```bash
# List services seen in APM for an environment
pup apm services list --env prod --from 7d --output json | jq -r '.data.attributes.services[]'

# Service latency/request stats for one service
pup apm services stats --env prod --from 1h --output json | jq '.data.attributes.services_stats[] | select(.service=="my-service")'

# Find entities when the exact service name is unclear
pup apm entities list --types service --env prod --from 7d --limit 100

# Inspect downstream dependencies for a service
pup apm dependencies list --env prod --from 1h --output json | jq '.["my-service"]'

# Aggregate span latency or volume
pup traces aggregate --query="service:my-service env:prod" --compute="percentile(@duration, 95)" --from 1h
pup traces aggregate --query="service:my-service env:prod" --compute="count" --group-by="operation_name" --from 1h

# Sample individual slow spans (@duration is in nanoseconds)
pup traces search --query="service:my-service env:prod @duration:>1000000000" --from 2h --limit 20
```

APM output shapes are inconsistent across commands:
- `pup apm services list` → `.data.attributes.services[]`
- `pup apm services stats` → `.data.attributes.services_stats[]`
- `pup apm dependencies list` → top-level object keyed by service name

If a wide APM stats query returns HTTP 503, retry with a narrower window first (for example `1h` or `24h`), then compare windows with `pup traces aggregate`.

### Dashboards

```bash
pup dashboards list
pup dashboards get abc-def-123
```

### Incidents

```bash
pup incidents list
pup incidents get abc-123-def
```

### SLOs

```bash
pup slos list
pup slos get abc-123-def
```

### Hosts / Infrastructure

```bash
pup infrastructure hosts list
pup infrastructure hosts list --filter="env:production"
pup infrastructure hosts get my-host
```

### Service Catalog

```bash
pup service-catalog list
pup service-catalog get service-name
```

### Events

```bash
pup events list
pup events search --query="tags:deployment"
pup events get 1234567890
```

### Synthetics

```bash
pup synthetics tests list
pup synthetics tests get test-id
pup synthetics locations list
```

### RUM

```bash
pup rum apps list
```

### Security

```bash
pup security rules list
pup security rules get rule-id
pup security signals list
```

### Audit Logs

```bash
pup audit-logs list
pup audit-logs search --query="@usr.name:admin@example.com"
pup audit-logs search --query="@evt.outcome:error"
```

### Teams / On-Call

```bash
pup on-call teams list
```

### Additional Commands

| Command | Purpose |
|---------|---------|
| `pup cases` | Case management |
| `pup cicd` | CI/CD visibility |
| `pup cost` | Cost and billing |
| `pup downtime` | Monitor downtimes |
| `pup error-tracking` | Error tracking |
| `pup notebooks` | Notebooks |
| `pup tags` | Host tags |
| `pup traces` | APM traces |
| `pup usage` | Usage/billing info |
| `pup users` | User management |
| `pup vulnerabilities` | Security vulnerabilities |

Use `pup <command> --help` for subcommand details.

## Latency Investigation Workflow

For requests like "this service got slower" or "latency increased since Monday":

1. **Confirm auth + service name**
   - `pup auth status`
   - `pup apm services list --env prod --from 7d --output json | jq -r '.data.attributes.services[]' | rg '<service-fragment>'`
2. **Measure the regression**
   - `pup traces aggregate --query='service:<service> env:prod' --compute='percentile(@duration, 95)' --from 1h`
   - Compare `1h`, `24h`, and `7d` windows.
3. **Break latency down by operation**
   - `pup traces aggregate --query='service:<service> env:prod' --compute='percentile(@duration, 95)' --group-by='operation_name' --from 1h`
   - Also check request volume: `--compute='count'`.
4. **Inspect slow examples**
   - `pup traces search --query='service:<service> env:prod @duration:>1000000000' --from 2h --limit 20`
5. **Check dependencies**
   - `pup apm dependencies list --env prod --from 1h --output json | jq '.["<service>"]'`
6. **Report concrete evidence**
   - Name the slow operations, latency percentiles, sample durations, dependency fan-out, and precise time window.

## Datadog Links

Always include direct links when referencing entities:
- Monitor: `https://app.datadoghq.com/monitors/<id>`
- Dashboard: `https://app.datadoghq.com/dashboard/<id>`
- Incident: `https://app.datadoghq.com/incidents/<id>`
- Service: `https://app.datadoghq.com/services/<name>`
- Logs: `https://app.datadoghq.com/logs?query=<url-encoded-query>`

## Best Practices

1. **Always include exact IDs** — Monitor #12345, not "the monitor"
2. **Include timestamps** — When things happened (UTC)
3. **Include quantities** — Actual numbers, not "some" or "several"
4. **Run queries in parallel** — Gather monitors + logs + metrics simultaneously
5. **When names are ambiguous, try common variants** — For example, kebab-case, snake_case, and concatenated forms in parallel
6. **Scope to user's team** — When user says "my services", use their team context
7. **Use `--output table`** — For human-readable summaries shown to user
8. **Prefer read-only commands** — Only use mutating `pup` actions when the user explicitly asks for changes
