#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  jmap-mailboxes.sh

Required environment:
  FASTMAIL_API_TOKEN

Optional environment:
  FASTMAIL_JMAP_SESSION_URL (default: https://api.fastmail.com/jmap/session)

Output:
  JSON array of mailboxes with id/name/role/totalEmails/unreadEmails
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${FASTMAIL_API_TOKEN:-}" ]]; then
  echo "Error: FASTMAIL_API_TOKEN is required" >&2
  exit 1
fi

session_url="${FASTMAIL_JMAP_SESSION_URL:-https://api.fastmail.com/jmap/session}"

session_json="$(curl -sS \
  -H "Authorization: Bearer $FASTMAIL_API_TOKEN" \
  "$session_url")"

api_url="$(echo "$session_json" | jq -r '.apiUrl // empty')"
account_id="$(echo "$session_json" | jq -r '.primaryAccounts["urn:ietf:params:jmap:mail"] // empty')"

if [[ -z "$api_url" || -z "$account_id" ]]; then
  echo "Error: could not resolve JMAP apiUrl/accountId from session" >&2
  echo "$session_json" | jq . >&2 || echo "$session_json" >&2
  exit 1
fi

payload="$(jq -n \
  --arg accountId "$account_id" \
  '{
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Mailbox/get", {accountId: $accountId}, "m1"]
    ]
  }'
)"

response_json="$(curl -sS \
  -H "Authorization: Bearer $FASTMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$api_url" \
  --data "$payload")"

echo "$response_json" \
  | jq '.methodResponses[0][1].list
    | sort_by(.name)
    | map({id, name, role, totalEmails, unreadEmails})'
