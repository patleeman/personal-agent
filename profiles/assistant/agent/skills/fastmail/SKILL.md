---
name: fastmail
description: Interact with Fastmail using direct API calls via CalDAV and JMAP, with explicit IMAP/CalDAV vs JMAP auth separation. Use when the user wants to list/create/delete calendar events, list mailboxes, or query recent email.
---

# Fastmail via CalDAV + JMAP (API-first)

Use direct HTTP calls only (`curl` + `jq`).

Prefer the bundled scripts in `scripts/` for repeatable operations.

## Credentials and endpoints

Fastmail uses different auth per protocol:

- **IMAP / SMTP / CalDAV**: Fastmail username + **app password**
- **JMAP**: Fastmail **API token** (`Authorization: Bearer ...`)

```bash
export FASTMAIL_USERNAME="you@example.com"
export FASTMAIL_APP_PASSWORD="<fastmail-app-password>"
# Recommended with 1Password:
# export FASTMAIL_APP_PASSWORD="op://Assistant/FASTMAIL_APP_PASSWORD/password"

# JMAP uses a separate token (do not reuse app password)
export FASTMAIL_JMAP_API_TOKEN="<fastmail-jmap-api-token>"
# Recommended with 1Password:
# export FASTMAIL_JMAP_API_TOKEN="op://Assistant/FASTMAIL_JMAP_API_TOKEN/credential"
# Optional fallback reference when FASTMAIL_JMAP_API_TOKEN is unset:
# export FASTMAIL_JMAP_API_TOKEN_OP_REF="op://Assistant/FASTMAIL_JMAP_API_TOKEN/credential"

export FASTMAIL_CALENDAR_URL="<calendar-url-from-fastmail-export>"
export FASTMAIL_JMAP_SESSION_URL="https://api.fastmail.com/jmap/session"

# Optional fail-fast controls for 1Password + network calls
export FASTMAIL_OP_READ_TIMEOUT_SECONDS=15
export FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS=10
export FASTMAIL_CURL_MAX_TIME_SECONDS=30
```

Get credentials from Fastmail settings:
- App password: `Settings -> Privacy & Security -> Manage app passwords and access`
- API token: `Settings -> Privacy & Security -> Manage API tokens`
- Calendar URL: `Settings -> Calendars -> <calendar> -> Export -> CalDAV URL`

## Bundled scripts (preferred)

### CalDAV

```bash
# List events in UTC window
./scripts/caldav-list-events.sh 20260301T000000Z 20260308T000000Z

# Add an event
./scripts/caldav-add-event.sh "Planning Block" 20260303T150000Z 20260303T153000Z

# Delete an event by URL or filename
./scripts/caldav-delete-event.sh https://caldav.fastmail.com/.../abc123.ics
./scripts/caldav-delete-event.sh abc123.ics
```

### JMAP

```bash
# List mailboxes
./scripts/jmap-mailboxes.sh

# Latest messages (default 10)
./scripts/jmap-latest-email.sh

# Latest 25
./scripts/jmap-latest-email.sh 25
```

## Raw API fallback examples

Use when you need custom behavior not covered by scripts.

### CalDAV REPORT (list events)

```bash
read -r -d '' CALDAV_REPORT_BODY <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="20260301T000000Z" end="20260308T000000Z"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>
XML

curl -sS -u "$FASTMAIL_USERNAME:$FASTMAIL_APP_PASSWORD" \
  -X REPORT "$FASTMAIL_CALENDAR_URL" \
  -H "Depth: 1" \
  -H "Content-Type: application/xml; charset=utf-8" \
  --data "$CALDAV_REPORT_BODY"
```

### JMAP session + mailbox list

```bash
fastmail_jmap_api_token="$FASTMAIL_JMAP_API_TOKEN"
if [[ "$fastmail_jmap_api_token" == op://* ]]; then
  fastmail_jmap_api_token="$(op --cache=false read "$fastmail_jmap_api_token")"
fi

session_json="$(curl -sS -H "Authorization: Bearer $fastmail_jmap_api_token" "$FASTMAIL_JMAP_SESSION_URL")"
api_url="$(echo "$session_json" | jq -r '.apiUrl')"
mail_account_id="$(echo "$session_json" | jq -r '.primaryAccounts["urn:ietf:params:jmap:mail"]')"

payload="$(jq -n \
  --arg accountId "$mail_account_id" \
  '{
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [["Mailbox/get", {accountId: $accountId}, "m1"]]
  }'
)"

curl -sS \
  -H "Authorization: Bearer $fastmail_jmap_api_token" \
  -H "Content-Type: application/json" \
  "$api_url" \
  --data "$payload"
```

## Notes

- Fastmail calendar access is currently via **CalDAV** (not general JMAP calendar APIs).
- Bundled scripts now fail fast on stalled 1Password or network calls (configurable via `FASTMAIL_OP_READ_TIMEOUT_SECONDS`, `FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS`, and `FASTMAIL_CURL_MAX_TIME_SECONDS`).
- If JMAP returns `Invalid Authorization bearer parameters`, the configured value is likely an app password (CalDAV) rather than a Fastmail API token.
- Keep tokens/passwords in env vars or a secret manager.
- Do not write secrets to repo files or durable memory.
