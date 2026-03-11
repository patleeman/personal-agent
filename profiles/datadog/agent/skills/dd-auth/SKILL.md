---
name: dd-auth
description: Use when asked about Datadog API authentication, getting API keys/app keys, internal JWTs, or ddtool auth/OIDC login flows. Covers dd-auth (public APIs), ddauth (internal services like Lambo), and ddtool auth troubleshooting.
---

# Datadog Authentication

Four common CLI paths cover most Datadog auth workflows: `dd-auth` for public APIs, `ddauth` for internal service JWTs, `ddtool auth` for identity- or vault-backed flows, and `pup auth` for OAuth-backed Datadog CLI access.

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

### Headless / SSH login
```bash
ddtool auth login --mode device
ddtool auth login --mode device --datacenter <dc>
```

- Use device mode when `ddtool`, `kubectl`, or another Datadog CLI tries to open browser-based OIDC from a headless shell, SSH session, or remote workspace.
- Add `--datacenter <dc>` when the command needs a specific Datadog identity or vault target.

### pup auth (Datadog CLI OAuth2)
```bash
pup auth status --output table
pup auth login
pup auth login --agent
```

- Prefer `pup auth status` over `pup test` when debugging auth; `pup test` is useful for site/output checks but may still show API keys as unset under OAuth2.
- Use `pup auth login --agent` for agent-driven CLI flows that still complete a local browser callback.

## Limitations

- No browser cookies available from CLI
- Cannot scrape authenticated web pages
- Use APIs instead of web scraping

## Quick Reference

| Need | Command |
|------|---------|
| Public API keys | `eval $(dd-auth env)` |
| Internal JWT | `ddauth obo -o <orgID>` |
| Headless `ddtool` / `kubectl` login | `ddtool auth login --mode device` |
| pup OAuth status | `pup auth status --output table` |
| pup OAuth login | `pup auth login --agent` |
| GitLab token | `ddtool auth gitlab token` |
| Force re-login | `dd-auth login` |
| Check status | `dd-auth status` |
