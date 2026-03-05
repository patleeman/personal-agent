---
name: fastmail
description: Interact with Fastmail using CalDAV for calendar operations and IMAP for mailbox/email queries. Use when the user wants to list/create/delete calendar events, list mailboxes, or query recent email.
---

# Fastmail via CalDAV + IMAP

Use the bundled scripts in `scripts/` for repeatable operations.

- **Calendar**: CalDAV (`curl`)
- **Mail**: IMAP (`python3` + `imaplib`)

## Credentials and endpoints

Fastmail uses app-password auth for IMAP/SMTP/CalDAV.

```bash
export FASTMAIL_USERNAME="you@example.com"
# Set to concrete value, or an op:// reference for IMAP scripts.
export FASTMAIL_APP_PASSWORD="<fastmail-app-password>"
# 1Password examples:
# export FASTMAIL_APP_PASSWORD="$(op --cache=false read op://Assistant/FASTMAIL_API_KEY/password)"
# export FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_API_KEY/password"

export FASTMAIL_CALENDAR_URL="<calendar-url-from-fastmail-export>"

# IMAP defaults (usually no override needed)
export FASTMAIL_IMAP_HOST="imap.fastmail.com"
export FASTMAIL_IMAP_PORT=993
export FASTMAIL_IMAP_TIMEOUT_SECONDS=30
export FASTMAIL_IMAP_MAILBOX="INBOX"

# Optional fail-fast controls
export FASTMAIL_OP_READ_TIMEOUT_SECONDS=15
export FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS=10
export FASTMAIL_CURL_MAX_TIME_SECONDS=30
```

Get credentials from Fastmail settings:
- App password: `Settings -> Privacy & Security -> Manage app passwords and access`
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

### IMAP

```bash
# List mailboxes
./scripts/imap-mailboxes.sh

# Latest messages from INBOX (default 10)
./scripts/imap-latest-email.sh

# Latest 25 from Archive
./scripts/imap-latest-email.sh 25 Archive
```

## Raw protocol fallback examples

Use these when you need behavior not covered by scripts.

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

### IMAP mailbox list (python)

```bash
python3 - <<'PY'
import imaplib
import json
import os

username = os.environ["FASTMAIL_USERNAME"]
password = os.environ["FASTMAIL_APP_PASSWORD"]
host = os.environ.get("FASTMAIL_IMAP_HOST", "imap.fastmail.com")
port = int(os.environ.get("FASTMAIL_IMAP_PORT", "993"))

with imaplib.IMAP4_SSL(host, port) as client:
    client.login(username, password)
    status, rows = client.list()
    if status != "OK":
        raise RuntimeError("IMAP LIST failed")

    mailboxes = [row.decode("utf-8", errors="replace") for row in rows or []]
    print(json.dumps(mailboxes, indent=2))
PY
```

## Notes

- Calendar access is via **CalDAV**.
- Mailbox/email queries now use **IMAP** (no JMAP token required).
- IMAP scripts fail fast on stalled 1Password reads (`FASTMAIL_OP_READ_TIMEOUT_SECONDS`) and socket timeouts (`FASTMAIL_IMAP_TIMEOUT_SECONDS`).
- CalDAV scripts honor `FASTMAIL_CURL_CONNECT_TIMEOUT_SECONDS` and `FASTMAIL_CURL_MAX_TIME_SECONDS`.
- Keep credentials in env vars or a secret manager.
- Do not write secrets to repo files, AGENTS.md, or skills.
