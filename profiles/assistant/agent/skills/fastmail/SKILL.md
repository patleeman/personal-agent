---
name: fastmail
description: Interact with Fastmail using direct API calls via CalDAV ("cadav") and JMAP. Use when the user wants to list/create/delete calendar events, list mailboxes, or query recent email.
---

# Fastmail via CalDAV + JMAP (API-first)

Use direct HTTP calls only (`curl` + `jq`).

Prefer the bundled scripts in `scripts/` for repeatable operations.

## Credentials and endpoints

Fastmail uses different auth per protocol:

- **CalDAV**: Fastmail username + **app password**
- **JMAP**: Fastmail **API token** (`Authorization: Bearer ...`)

```bash
export FASTMAIL_USERNAME="you@example.com"
export FASTMAIL_APP_PASSWORD="<fastmail-app-password>"
export FASTMAIL_API_TOKEN="<fastmail-api-token>"

export FASTMAIL_CALENDAR_URL="<calendar-url-from-fastmail-export>"
export FASTMAIL_JMAP_SESSION_URL="https://api.fastmail.com/jmap/session"
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
session_json="$(curl -sS -H "Authorization: Bearer $FASTMAIL_API_TOKEN" "$FASTMAIL_JMAP_SESSION_URL")"
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
  -H "Authorization: Bearer $FASTMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$api_url" \
  --data "$payload"
```

## Notes

- Fastmail calendar access is currently via **CalDAV** (not general JMAP calendar APIs).
- Keep tokens/passwords in env vars or a secret manager.
- Do not write secrets to repo files or durable memory.
