#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  jmap-latest-email.sh [limit]

Arguments:
  limit   Optional. Number of messages (default: 10)

Required environment:
  FASTMAIL_API_TOKEN

Optional environment:
  FASTMAIL_JMAP_SESSION_URL (default: https://api.fastmail.com/jmap/session)

Output:
  JSON array with latest messages (id, receivedAt, subject, from)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

limit="${1:-10}"

if ! [[ "$limit" =~ ^[0-9]+$ ]]; then
  echo "Error: limit must be a non-negative integer" >&2
  exit 1
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
  --argjson limit "$limit" \
  '{
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Email/query", {
        accountId: $accountId,
        sort: [{property: "receivedAt", isAscending: false}],
        limit: $limit
      }, "q1"],
      ["Email/get", {
        accountId: $accountId,
        properties: ["id", "subject", "from", "receivedAt"],
        "#ids": {resultOf: "q1", name: "Email/query", path: "/ids/*"}
      }, "g1"]
    ]
  }'
)"

response_json="$(curl -sS \
  -H "Authorization: Bearer $FASTMAIL_API_TOKEN" \
  -H "Content-Type: application/json" \
  "$api_url" \
  --data "$payload")"

echo "$response_json" | jq '
  .methodResponses
  | map(select(.[0] == "Email/get"))[0][1].list
  | map({
      id,
      receivedAt,
      subject,
      from: ((.from // []) | map(.name // .email) | join(", "))
    })
'
