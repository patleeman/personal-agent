---
name: dd-updog
description: Use when asked to check if a third-party service is down, experiencing outages, or having issues. Covers AWS, GCP, Azure, GitHub, OpenAI, Cloudflare, Stripe, Slack, and many more via updog.ai data.
---

# Third-Party Service Status (Updog)

Check third-party service outages using data from [updog.ai](https://updog.ai).

## Usage

Fetch outage data with `curl`:

```bash
curl -s "https://updog.ai/data/third-party-outages.json" | jq .
```

For impact assessments, use `https://updog.ai/data/third-party-impacts.json`.

## Response Structure

```json
{
  "data": {
    "attributes": {
      "provider_data": [
        {
          "provider_name": "string",
          "provider_service": "string (e.g., 's3' for AWS)",
          "display_name": "string",
          "status_url": "string",
          "outages": [
            {
              "start": 1765264200000,
              "end": 1765266000000,
              "status": "resolved|ongoing",
              "impacted_region": "us-east-1"
            }
          ]
        }
      ]
    }
  }
}
```

## Checking for Active Outages

An outage is **active** if: `end` is null, OR `end` is in the future, OR `status` is not `"resolved"`.

**Check specific service:**
```bash
curl -s "https://updog.ai/data/third-party-outages.json" | \
  jq '.data.attributes.provider_data[] | select(.provider_name | test("github"; "i")) | {display_name, status_url, active_outages: [.outages[] | select(.end == null or (.end != null and .end > (now * 1000)) or .status != "resolved")]}'
```

**Check all current outages:**
```bash
curl -s "https://updog.ai/data/third-party-outages.json" | \
  jq '[.data.attributes.provider_data[] | {name: .display_name, service: .provider_service, status_url, active: [.outages[] | select(.end == null or (.end != null and .end > (now * 1000)) or .status != "resolved")]} | select(.active | length > 0)]'
```

## Common Providers

| Provider | Filter Pattern | Services |
|----------|---------------|----------|
| AWS | `amazonaws` | S3, EC2, Lambda, DynamoDB, RDS |
| GCP | `googleapis` | Compute, Storage, BigQuery |
| Azure | `azure` | Various services |
| Cloudflare | `cloudflare` | CDN, DNS, Workers |
| GitHub | `github` | API, Actions, Packages |
| OpenAI | `openai` | API |
| Stripe | `stripe` | Payments API |
| Slack | `slack` | Messaging API |
| Datadog | `datadoghq` | Monitoring |

## Timestamps

Values are epoch milliseconds. Convert: `date -r $((timestamp / 1000))`.

## Response Format

```
## Service Status: [Provider]

**Status**: UP / DOWN / DEGRADED
**Status Page**: [URL]

### Active Outages
- [Region]: Started [time], ongoing

### Recent Incidents (Last 48h)
- [Date]: [Duration] outage affecting [region]
```
