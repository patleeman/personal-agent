---
name: dd-feature-flags
description: Use when asked about Datadog internal feature flags, SDP Experiments, Degradation Knobs, or Consul Config. Triggers on questions like "what feature flags exist for X?", "is this flag enabled?", "show me my team's knobs", or references to sdp.ddbuild.io.
---

# Datadog Feature Flags

Query Datadog's three internal feature flag systems: SDP Experiments, Degradation Knobs, and Consul Config.

## Overview

| System | Purpose | API Support |
|--------|---------|-------------|
| **SDP Experiments** | Full A/B tests and feature flags with rollouts, targeting, approvals | List + basic details |
| **Degradation Knobs** | Simple on/off switches for graceful degradation | Full details (team, service, overrides) |
| **Consul Config** | Legacy flags (being migrated to SDP) | File-based search |

## Prerequisites

```bash
# Get auth token for SDP API
SDP_TOKEN=$(ddtool auth token sdm --datacenter=us1.release.mgmt.dog)
```

## API Endpoints

### SDP Experiments

**List/search experiments:**
```bash
SDP_TOKEN=$(ddtool auth token sdm --datacenter=us1.release.mgmt.dog)
curl -s "https://experiments-api.us1.release.mgmt.dog/feature-flags/?search=<query>" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq '.[] | {id, name, description, state}'
```

**Filter by state** (LIVE, DRAFT, DEPLOYED, CANCELLED, DECOMMISSIONED):
```bash
curl -s "https://experiments-api.us1.release.mgmt.dog/feature-flags/?search=<query>&state=LIVE" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq .
```

**API limitation:** Experiments REST API only returns `id`, `name`, `description`, `state`. Team ownership, Slack channels, rollout plans, and revision history are NOT available via API. Direct users to the Web UI for these details.

### Degradation Knobs

**Search knobs:**
```bash
SDP_TOKEN=$(ddtool auth token sdm --datacenter=us1.release.mgmt.dog)
curl -s "https://experiments-api.us1.release.mgmt.dog/gd/v1/degradation-knobs?search=<query>" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq .
```

**Filter by team:**
```bash
curl -s "https://experiments-api.us1.release.mgmt.dog/gd/v1/degradation-knobs?team=<team-tag>" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq .
```

**Filter by service:**
```bash
curl -s "https://experiments-api.us1.release.mgmt.dog/gd/v1/degradation-knobs?service=<service-name>" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq .
```

**Get specific knob (full details):**
```bash
curl -s "https://experiments-api.us1.release.mgmt.dog/gd/v1/degradation-knobs/<knob-id>" \
  -H "Authorization: Bearer ${SDP_TOKEN}" | jq .
```

Knobs API returns complete info: team tags, service tags, overrides, targeting rules, environments.

## State Indicators

| State | System | Meaning |
|-------|--------|---------|
| 🟢 LIVE | Experiments | Active and running |
| 🚀 DEPLOYED | Experiments | Rolled out |
| 📝 DRAFT | Experiments | Not yet deployed |
| ❌ CANCELLED | Experiments | Disabled |
| ✅ ACTIVATED | Knobs | Enabled |
| ❌ DEACTIVATED | Knobs | Disabled |

## Web UI Links

Always provide direct links:
- **Experiments:** `https://sdp.ddbuild.io/#/feature-flags/<flag-id>`
- **Knobs:** `https://sdp.ddbuild.io/#/degradation-knobs/<knob-id>`
- **Main UI:** `https://sdp.ddbuild.io/#/feature-flags`

## When to Direct Users to Web UI

The REST API cannot provide:
- Team/owner info for experiments
- Revision history
- Rollout plans and approval workflows
- Slack channel configuration
- Creating or updating flags (read-only)

Always say: *"For full details, check the Web UI: [link]"*

## Resources

| Resource | URL |
|----------|-----|
| SDP Web UI | `https://sdp.ddbuild.io/#/feature-flags` |
| Knobs Swagger | `https://experiments-api.us1.release.mgmt.dog/gd/v1/docs/` |
| Confluence | `https://datadoghq.atlassian.net/wiki/spaces/RCFG` |
| Slack | `#feature-flags`, `#degradation-knobs`, `#runtime-configuration` |

## Migration Note

Consul Config flags are being migrated to SDP. When flags appear in both systems, prefer SDP. New flags should always use SDP.
