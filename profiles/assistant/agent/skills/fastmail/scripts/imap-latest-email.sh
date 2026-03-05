#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OP_READ_TIMEOUT_SECONDS=15
DEFAULT_IMAP_HOST="imap.fastmail.com"
DEFAULT_IMAP_PORT=993
DEFAULT_IMAP_TIMEOUT_SECONDS=30
DEFAULT_IMAP_MAILBOX="INBOX"
DEFAULT_LIMIT=10

usage() {
  cat <<'EOF'
Usage:
  imap-latest-email.sh [limit] [mailbox]

Arguments:
  limit    Optional. Number of messages (default: 10)
  mailbox  Optional. Mailbox name (default: INBOX or FASTMAIL_IMAP_MAILBOX)

Required environment:
  FASTMAIL_USERNAME
  FASTMAIL_APP_PASSWORD (or FASTMAIL_APP_PASSWORD_OP_REF)

Optional environment:
  FASTMAIL_APP_PASSWORD_OP_REF (default fallback: op://Assistant/FASTMAIL_API_KEY/password)
  FASTMAIL_IMAP_HOST (default: imap.fastmail.com)
  FASTMAIL_IMAP_PORT (default: 993)
  FASTMAIL_IMAP_TIMEOUT_SECONDS (default: 30)
  FASTMAIL_IMAP_MAILBOX (default: INBOX)
  FASTMAIL_OP_READ_TIMEOUT_SECONDS (default: 15)

Output:
  JSON array with latest messages (uid, receivedAt, subject, from)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

limit="${1:-$DEFAULT_LIMIT}"
mailbox="${2:-${FASTMAIL_IMAP_MAILBOX:-$DEFAULT_IMAP_MAILBOX}}"

if ! [[ "$limit" =~ ^[0-9]+$ ]]; then
  echo "Error: limit must be a non-negative integer" >&2
  exit 1
fi

resolve_positive_int() {
  local raw="${1:-}"
  local fallback="$2"

  if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw > 0 )); then
    printf '%s' "$raw"
    return
  fi

  printf '%s' "$fallback"
}

op_read_timeout_seconds="$(resolve_positive_int "${FASTMAIL_OP_READ_TIMEOUT_SECONDS:-$DEFAULT_OP_READ_TIMEOUT_SECONDS}" "$DEFAULT_OP_READ_TIMEOUT_SECONDS")"
imap_host="${FASTMAIL_IMAP_HOST:-$DEFAULT_IMAP_HOST}"
imap_port="$(resolve_positive_int "${FASTMAIL_IMAP_PORT:-$DEFAULT_IMAP_PORT}" "$DEFAULT_IMAP_PORT")"
imap_timeout_seconds="$(resolve_positive_int "${FASTMAIL_IMAP_TIMEOUT_SECONDS:-$DEFAULT_IMAP_TIMEOUT_SECONDS}" "$DEFAULT_IMAP_TIMEOUT_SECONDS")"

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

if [[ -z "$imap_host" ]]; then
  echo "Error: FASTMAIL_IMAP_HOST cannot be empty" >&2
  exit 1
fi

if [[ -z "$mailbox" ]]; then
  echo "Error: mailbox cannot be empty" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required" >&2
  exit 1
fi

op_read_reference() {
  local reference="$1"

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "$op_read_timeout_seconds" op --cache=false read "$reference"
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node - "$reference" "$op_read_timeout_seconds" <<'NODE'
const { spawnSync } = require('node:child_process');

const reference = process.argv[2];
const timeoutSeconds = Number.parseInt(process.argv[3], 10);
const timeoutMs = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
  ? timeoutSeconds * 1000
  : 15_000;

const result = spawnSync('op', ['--cache=false', 'read', reference], {
  encoding: 'utf-8',
  env: process.env,
  timeout: timeoutMs,
});

if (result.error) {
  const code = result.error.code;

  if (code === 'ETIMEDOUT') {
    process.stderr.write(`Error: timed out after ${Math.floor(timeoutMs / 1000)}s while reading 1Password reference\n`);
    process.exit(1);
  }

  if (code === 'ENOENT') {
    process.stderr.write('Error: op CLI not found while resolving 1Password reference\n');
    process.exit(1);
  }

  process.stderr.write(`Error: failed to execute op read: ${result.error.message}\n`);
  process.exit(1);
}

const status = result.status ?? 1;
if (status !== 0) {
  const detail = (result.stderr || result.stdout || '').trim();
  if (detail.length > 0) {
    process.stderr.write(`${detail}\n`);
  } else {
    process.stderr.write(`Error: op read exited with code ${status}\n`);
  }

  process.exit(status);
}

process.stdout.write(result.stdout ?? '');
NODE
    return
  fi

  op --cache=false read "$reference"
}

resolve_fastmail_app_password() {
  local configured_value="${FASTMAIL_APP_PASSWORD:-}"

  if [[ -n "$configured_value" ]]; then
    if [[ "$configured_value" == op://* ]]; then
      if ! command -v op >/dev/null 2>&1; then
        echo "Error: op CLI is required to resolve FASTMAIL_APP_PASSWORD reference" >&2
        return 1
      fi

      op_read_reference "$configured_value"
      return
    fi

    printf '%s' "$configured_value"
    return
  fi

  local fallback_ref="${FASTMAIL_APP_PASSWORD_OP_REF:-op://Assistant/FASTMAIL_API_KEY/password}"
  if ! command -v op >/dev/null 2>&1; then
    echo "Error: FASTMAIL_APP_PASSWORD is required, or install op to use FASTMAIL_APP_PASSWORD_OP_REF" >&2
    return 1
  fi

  op_read_reference "$fallback_ref"
}

if ! fastmail_app_password="$(resolve_fastmail_app_password)"; then
  exit 1
fi

if [[ -z "$fastmail_app_password" ]]; then
  echo "Error: Fastmail app password resolved to an empty value" >&2
  exit 1
fi

FASTMAIL_RESOLVED_APP_PASSWORD="$fastmail_app_password" \
python3 - "$FASTMAIL_USERNAME" "$imap_host" "$imap_port" "$imap_timeout_seconds" "$mailbox" "$limit" <<'PY'
import imaplib
import json
import os
import re
import socket
import sys
from datetime import datetime
from email.header import decode_header, make_header
from email.parser import BytesParser
from email import policy


class ScriptError(Exception):
    pass


def fail(message: str) -> None:
    raise ScriptError(message)


def decode_header_value(value: str | None) -> str:
    if not value:
        return ""

    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def normalize_internal_date(raw: str | None) -> str:
    if not raw:
        return ""

    try:
        return datetime.strptime(raw, "%d-%b-%Y %H:%M:%S %z").isoformat()
    except ValueError:
        return raw


INTERNALDATE_PATTERN = re.compile(rb'INTERNALDATE "([^"]+)"')


def parse_fetch_response(parts: list[object]) -> tuple[bytes, str]:
    header_bytes = b""
    internal_date = ""

    for part in parts:
        if isinstance(part, tuple):
            metadata = part[0] if len(part) > 0 else b""
            payload = part[1] if len(part) > 1 else b""

            if isinstance(metadata, (bytes, bytearray)) and not internal_date:
                match = INTERNALDATE_PATTERN.search(bytes(metadata))
                if match:
                    internal_date = match.group(1).decode("utf-8", errors="replace")

            if isinstance(payload, (bytes, bytearray)):
                header_bytes += bytes(payload)
            continue

        if isinstance(part, (bytes, bytearray)) and not internal_date:
            match = INTERNALDATE_PATTERN.search(bytes(part))
            if match:
                internal_date = match.group(1).decode("utf-8", errors="replace")

    return header_bytes, internal_date


def main() -> int:
    if len(sys.argv) != 7:
        fail("internal argument error")

    username = sys.argv[1]
    host = sys.argv[2]

    try:
        port = int(sys.argv[3])
        timeout_seconds = int(sys.argv[4])
        mailbox = sys.argv[5]
        limit = int(sys.argv[6])
    except ValueError as exc:
        fail(f"invalid numeric argument: {exc}")

    if limit < 0:
        fail("limit must be a non-negative integer")

    password = os.environ.get("FASTMAIL_RESOLVED_APP_PASSWORD", "")
    if not password:
        fail("resolved FASTMAIL_APP_PASSWORD was empty")

    client: imaplib.IMAP4_SSL | None = None

    try:
        socket.setdefaulttimeout(timeout_seconds)

        try:
            client = imaplib.IMAP4_SSL(host, port, timeout=timeout_seconds)
        except TypeError:
            client = imaplib.IMAP4_SSL(host, port)

        login_status, _ = client.login(username, password)
        if login_status != "OK":
            fail(f"IMAP login returned unexpected status {login_status}")

        select_status, _ = client.select(mailbox, readonly=True)
        if select_status != "OK":
            fail(f"failed to select mailbox '{mailbox}'")

        if limit == 0:
            print("[]")
            return 0

        search_status, search_parts = client.uid("search", None, "ALL")
        if search_status != "OK" or not search_parts:
            fail("IMAP UID SEARCH failed")

        uid_blob = search_parts[0] if isinstance(search_parts[0], (bytes, bytearray)) else b""
        all_uids = uid_blob.split()
        if not all_uids:
            print("[]")
            return 0

        selected_uids = list(reversed(all_uids[-limit:]))
        results: list[dict[str, str]] = []

        for raw_uid in selected_uids:
            uid = raw_uid.decode("utf-8", errors="replace")

            fetch_status, fetch_parts = client.uid(
                "fetch",
                uid,
                "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] INTERNALDATE)",
            )

            if fetch_status != "OK" or not fetch_parts:
                fail(f"IMAP UID FETCH failed for UID {uid}")

            header_bytes, internal_date_raw = parse_fetch_response(fetch_parts)
            parsed_headers = BytesParser(policy=policy.default).parsebytes(header_bytes)

            subject = decode_header_value(parsed_headers.get("Subject"))
            from_header = decode_header_value(parsed_headers.get("From"))
            date_header = decode_header_value(parsed_headers.get("Date"))
            received_at = normalize_internal_date(internal_date_raw) or date_header

            results.append(
                {
                    "uid": uid,
                    "receivedAt": received_at,
                    "subject": subject,
                    "from": from_header,
                }
            )

        print(json.dumps(results, indent=2))
        return 0

    except imaplib.IMAP4.error as exc:
        fail(f"IMAP request failed: {exc}")
    except OSError as exc:
        fail(f"network error while talking to IMAP server: {exc}")
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ScriptError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
PY
