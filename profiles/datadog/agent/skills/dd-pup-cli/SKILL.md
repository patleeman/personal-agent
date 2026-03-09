---
name: dd-pup-cli
description: Use when asked to query Datadog APIs — monitors, logs, metrics, dashboards, incidents, SLOs, hosts, traces, software catalog, or any Datadog platform data. Also use for charting/graphing Datadog metrics or logs.
---

# Datadog API via pup CLI

Query any Datadog data using `pup`, a Go-based CLI wrapper for Datadog APIs.

## Authentication

pup uses OAuth2 (recommended) or API keys. Test connectivity first:

```bash
pup test
```

If not authenticated:
```bash
pup auth login    # OAuth2 browser-based login
```

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
5. **Try naming variations** — `ai-gateway`, `aigateway`, `ai_gateway` in parallel
6. **Scope to user's team** — When user says "my services", use their team context
7. **Use `--output table`** — For human-readable summaries shown to user
8. **Prefer read-only commands** — Only use mutating `pup` actions when the user explicitly asks for changes
