---
name: dd-identity
description: Use when asked to look up Datadog employees, find someone's GitHub handle, Slack ID, email, team membership, or do reverse lookups (GitHub handle → email, Slack ID → email). Uses ddtool directory.
---

# Datadog Employee Directory

Look up employees, GitHub handles, Slack IDs, and team memberships via `ddtool directory`.

## Identity Commands

### Get a specific person's info
```bash
ddtool directory identity get <email> --format json
```

**Returns:** `full_name`, `github_handle`, `github_emu_handle`, `slack_handle`, `slack_id`, `workday_team`

### List all identities
```bash
ddtool directory identity list --format json
```

## Group Commands

### Get group info
```bash
ddtool directory group get <group_name> --format json
```

### List all groups
```bash
ddtool directory group list --format json
```

## Available Fields

| Field | Description |
|-------|-------------|
| `name` | Primary email |
| `emails` | All email aliases (datadoghq.com, datadog.com, datadog.fr) |
| `full_name` | Display name |
| `github_handle` | GitHub username |
| `github_emu_handle` | GitHub EMU handle (for DataDog org) |
| `slack_handle` | Slack display name |
| `slack_id` | Slack user ID for mentions (`<@UXXXXXX>`) |
| `workday_team` | Official team from Workday |

## Common Lookups

### Email → GitHub handle
```bash
ddtool directory identity get john.doe@datadoghq.com --format json | jq -r '.[0].attributes.github_handle'
```

### Email → Slack ID
```bash
ddtool directory identity get john.doe@datadoghq.com --format json | jq -r '.[0].attributes.slack_id'
```

### Email → Team
```bash
ddtool directory identity get john.doe@datadoghq.com --format json | jq -r '.[0].attributes.workday_team'
```

### Email → Full info
```bash
ddtool directory identity get john.doe@datadoghq.com --format json | jq '.[0].attributes'
```

## Reverse Lookups

Server-side filtering on attributes isn't supported. Fetch all identities and filter with jq.

### GitHub handle → email
```bash
ddtool directory identity list --format json | jq -r '.[] | select(.attributes.github_handle == "johndoe") | .name'
```

### Slack ID → email
```bash
ddtool directory identity list --format json | jq -r '.[] | select(.attributes.slack_id == "U0123ABCD") | .name'
```

### Name search (partial match)
```bash
ddtool directory identity list --format json | jq -r '.[] | select(.attributes.full_name | test("smith"; "i")) | {name, full_name: .attributes.full_name, team: .attributes.workday_team}'
```

## Output Formats

All commands support `--format`: `json` (default), `yaml`, `summary`, `name-only`.

Add `--verbose` to summary format for more details.
