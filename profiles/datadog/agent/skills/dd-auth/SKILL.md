---
name: dd-auth
description: Use when asked about Datadog API authentication, getting API keys, app keys, or JWT tokens for internal services. Covers dd-auth (public APIs) and ddauth (internal services like Lambo). Also use when troubleshooting authentication failures.
---

# Datadog Authentication

Two CLI tools for Datadog API authentication.

## dd-auth (Public APIs)

For Datadog public APIs — monitors, dashboards, logs, metrics, incidents, etc.

### Get credentials
```bash
eval $(dd-auth env)
# Sets: DD_API_KEY, DD_APP_KEY, DD_SITE
```

### Use in API calls
```bash
eval $(dd-auth env)
curl -s "https://api.${DD_SITE}/api/v1/monitor" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APP_KEY}"
```

### Key types
- **DD_API_KEY** — Org identity
- **DD_APP_KEY** — User identity + permissions
- **DD_SITE** — API endpoint (e.g., `datadoghq.com`)
- Direct Datadog public API calls made with `curl` typically require both keys
- Auto-cached 30 minutes, auto-refreshes

### Troubleshooting
- Auth failed → `dd-auth login`
- Check status → `dd-auth status`
- Force refresh → `dd-auth refresh`

## ddauth (Internal Services)

For Datadog internal services — Lambo, internal APIs, etc.

### Get JWT token
```bash
ddauth obo -o <orgID>
# Returns a JWT token (1-hour expiry)
```

### Common org IDs
Use the org ID relevant to your environment. Check with your team for the correct value.

### Use in API calls
```bash
TOKEN=$(ddauth obo -o 2)
curl -s "https://internal-service.datadoghq.com/api/endpoint" \
  -H "Authorization: Bearer ${TOKEN}"
```

### ddtool auth (for specific services)
```bash
# GitLab token
ddtool auth gitlab token

# GitLab login (browser OAuth)
ddtool auth gitlab login

# SDP/Experiments token
ddtool auth token sdm --datacenter=us1.release.mgmt.dog
```

## Limitations

- No browser cookies available from CLI
- Cannot scrape authenticated web pages
- Use APIs instead of web scraping

## Quick Reference

| Need | Command |
|------|---------|
| Public API keys | `eval $(dd-auth env)` |
| Internal JWT | `ddauth obo -o <orgID>` |
| GitLab token | `ddtool auth gitlab token` |
| Force re-login | `dd-auth login` |
| Check status | `dd-auth status` |
