#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OP_READ_TIMEOUT_SECONDS=15
DEFAULT_PRIMARY_FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_APP_PASSWORD/password"
DEFAULT_LEGACY_FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_API_KEY/password"
DEFAULT_IMAP_HOST="imap.fastmail.com"
DEFAULT_IMAP_PORT=993
DEFAULT_IMAP_TIMEOUT_SECONDS=30

usage() {
  cat <<'EOF'
Usage:
  imap-mailboxes.sh

Required environment:
  FASTMAIL_USERNAME
  FASTMAIL_APP_PASSWORD (or FASTMAIL_APP_PASSWORD_OP_REF)

Optional environment:
  FASTMAIL_APP_PASSWORD_OP_REF (default preferred ref: op://Assistant/FASTMAIL_APP_PASSWORD/password; legacy fallback: op://Assistant/FASTMAIL_API_KEY/password)
  FASTMAIL_IMAP_HOST (default: imap.fastmail.com)
  FASTMAIL_IMAP_PORT (default: 993)
  FASTMAIL_IMAP_TIMEOUT_SECONDS (default: 30)
  FASTMAIL_OP_READ_TIMEOUT_SECONDS (default: 15)

Output:
  JSON array of mailboxes with name/flags/delimiter and status counts where available.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 0 ]]; then
  usage >&2
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

resolve_default_fastmail_app_password_reference() {
  local primary_ref="$DEFAULT_PRIMARY_FASTMAIL_APP_PASSWORD_OP_REF"
  local legacy_ref="$DEFAULT_LEGACY_FASTMAIL_APP_PASSWORD_OP_REF"
  local resolved_value=""

  if resolved_value="$(op_read_reference "$primary_ref" 2>/dev/null)"; then
    printf '%s' "$resolved_value"
    return
  fi

  if [[ "$legacy_ref" != "$primary_ref" ]] && resolved_value="$(op_read_reference "$legacy_ref" 2>/dev/null)"; then
    printf '%s' "$resolved_value"
    return
  fi

  op_read_reference "$primary_ref"
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

  if ! command -v op >/dev/null 2>&1; then
    echo "Error: FASTMAIL_APP_PASSWORD is required, or install op to use FASTMAIL_APP_PASSWORD_OP_REF" >&2
    return 1
  fi

  if [[ -n "${FASTMAIL_APP_PASSWORD_OP_REF:-}" ]]; then
    op_read_reference "$FASTMAIL_APP_PASSWORD_OP_REF"
    return
  fi

  resolve_default_fastmail_app_password_reference
}

if ! fastmail_app_password="$(resolve_fastmail_app_password)"; then
  exit 1
fi

if [[ -z "$fastmail_app_password" ]]; then
  echo "Error: Fastmail app password resolved to an empty value" >&2
  exit 1
fi

FASTMAIL_RESOLVED_APP_PASSWORD="$fastmail_app_password" \
python3 - "$FASTMAIL_USERNAME" "$imap_host" "$imap_port" "$imap_timeout_seconds" <<'PY'
import imaplib
import json
import os
import re
import socket
import sys
from typing import Any


class ScriptError(Exception):
    pass


def fail(message: str) -> None:
    raise ScriptError(message)


def parse_quoted_token(token: str) -> str | None:
    if token.upper() == "NIL":
        return None

    if token.startswith('"') and token.endswith('"'):
        inner = token[1:-1]
        return inner.replace(r'\\', '\\').replace(r'\"', '"')

    return token


def parse_mailbox_line(raw_line: bytes) -> dict[str, Any]:
    text = raw_line.decode("utf-8", errors="replace")
    match = re.match(
        r'^\((?P<flags>[^)]*)\)\s+(?P<delimiter>NIL|"(?:[^"\\]|\\.)*")\s+(?P<mailbox>.+)$',
        text,
    )

    if not match:
        return {
            "name": text,
            "flags": [],
            "delimiter": None,
        }

    flags = [flag for flag in match.group("flags").split() if flag]
    delimiter_token = match.group("delimiter")
    mailbox_token = match.group("mailbox").strip()

    mailbox_name = parse_quoted_token(mailbox_token)
    if mailbox_name is None:
        mailbox_name = mailbox_token

    return {
        "name": mailbox_name,
        "flags": flags,
        "delimiter": parse_quoted_token(delimiter_token),
    }


STATUS_FIELD_PATTERN = re.compile(r'\b(MESSAGES|UNSEEN|RECENT|UIDNEXT)\s+(\d+)\b', re.IGNORECASE)


def parse_status_counts(response_parts: list[Any]) -> dict[str, int]:
    chunks: list[bytes] = []
    for part in response_parts:
        if isinstance(part, (bytes, bytearray)):
            chunks.append(bytes(part))

    text = b" ".join(chunks).decode("utf-8", errors="replace")
    counts: dict[str, int] = {}

    for key, raw_value in STATUS_FIELD_PATTERN.findall(text):
        counts[key.lower()] = int(raw_value)

    return counts


def main() -> int:
    if len(sys.argv) != 5:
        fail("internal argument error")

    username = sys.argv[1]
    host = sys.argv[2]

    try:
        port = int(sys.argv[3])
        timeout_seconds = int(sys.argv[4])
    except ValueError as exc:
        fail(f"invalid numeric argument: {exc}")

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

        list_status, raw_mailboxes = client.list()
        if list_status != "OK" or raw_mailboxes is None:
            fail(f"IMAP LIST returned unexpected status {list_status}")

        results: list[dict[str, Any]] = []

        for raw_line in raw_mailboxes:
            if not isinstance(raw_line, (bytes, bytearray)):
                continue

            mailbox = parse_mailbox_line(bytes(raw_line))
            mailbox_name = mailbox["name"]
            flags = {str(flag).lower() for flag in mailbox.get("flags", [])}

            if "\\noselect" not in flags:
                status_result, status_parts = client.status(mailbox_name, "(MESSAGES UNSEEN RECENT UIDNEXT)")
                if status_result == "OK" and status_parts is not None:
                    mailbox.update(parse_status_counts(status_parts))

            results.append(mailbox)

        results.sort(key=lambda item: str(item.get("name", "")).lower())
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
