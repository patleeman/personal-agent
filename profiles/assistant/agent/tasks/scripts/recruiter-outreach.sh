#!/usr/bin/env bash
set -euo pipefail

DEFAULT_IMAP_HOST="imap.fastmail.com"
DEFAULT_IMAP_PORT=993
DEFAULT_IMAP_TIMEOUT_SECONDS=30
DEFAULT_OP_READ_TIMEOUT_SECONDS=20
DEFAULT_TIMEZONE="America/New_York"

usage() {
  cat <<'EOF'
Usage:
  recruiter-outreach.sh [--days N] [--bootstrap]

Scans Fastmail IMAP for recruiter-like messages in a time window, appends new
records to a JSONL store, and prints a compact sync summary.

Options:
  --days N      Scan the trailing N days ending now (instead of previous local day)
  --bootstrap   Rebuild the store from the current scan window

Environment (required):
  FASTMAIL_USERNAME

Environment (optional):
  FASTMAIL_APP_PASSWORD
  FASTMAIL_API_KEY
  FASTMAIL_APP_PASSWORD_OP_REF
  FASTMAIL_API_KEY_OP_REF
  FASTMAIL_SECRET_RESOLVER (auto|sdk-only|op-only|env-only; default: auto)
  FASTMAIL_IMAP_HOST (default: imap.fastmail.com)
  FASTMAIL_IMAP_PORT (default: 993)
  FASTMAIL_IMAP_TIMEOUT_SECONDS (default: 30)
  FASTMAIL_OP_READ_TIMEOUT_SECONDS (default: 20)
  RECRUITER_OUTREACH_TIMEZONE (default: America/New_York)
  RECRUITER_OUTREACH_STORE_FILE (default: ~/.local/state/personal-agent/recruiter-outreach/recruiter_outreach.jsonl)
EOF
}

resolve_positive_int() {
  local raw="${1:-}"
  local fallback="$2"

  if [[ "$raw" =~ ^[0-9]+$ ]] && (( raw > 0 )); then
    printf '%s' "$raw"
    return
  fi

  printf '%s' "$fallback"
}

bootstrap=0
days=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bootstrap)
      bootstrap=1
      shift
      ;;
    --days)
      if [[ $# -lt 2 ]]; then
        echo "Error: --days requires a positive integer" >&2
        exit 1
      fi
      if ! [[ "$2" =~ ^[0-9]+$ ]] || (( 10#$2 <= 0 )); then
        echo "Error: --days requires a positive integer" >&2
        exit 1
      fi
      days="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${FASTMAIL_USERNAME:-}" ]]; then
  echo "Error: FASTMAIL_USERNAME is required" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required" >&2
  exit 1
fi

op_read_timeout_seconds="$(resolve_positive_int "${FASTMAIL_OP_READ_TIMEOUT_SECONDS:-$DEFAULT_OP_READ_TIMEOUT_SECONDS}" "$DEFAULT_OP_READ_TIMEOUT_SECONDS")"
imap_host="${FASTMAIL_IMAP_HOST:-$DEFAULT_IMAP_HOST}"
imap_port="$(resolve_positive_int "${FASTMAIL_IMAP_PORT:-$DEFAULT_IMAP_PORT}" "$DEFAULT_IMAP_PORT")"
imap_timeout_seconds="$(resolve_positive_int "${FASTMAIL_IMAP_TIMEOUT_SECONDS:-$DEFAULT_IMAP_TIMEOUT_SECONDS}" "$DEFAULT_IMAP_TIMEOUT_SECONDS")"
resolver_mode="${FASTMAIL_SECRET_RESOLVER:-auto}"
report_timezone="${RECRUITER_OUTREACH_TIMEZONE:-$DEFAULT_TIMEZONE}"

state_root="${PERSONAL_AGENT_STATE_ROOT:-${XDG_STATE_HOME:+$XDG_STATE_HOME/personal-agent}}"
if [[ -z "$state_root" ]]; then
  state_root="$HOME/.local/state/personal-agent"
fi

store_file_default="$state_root/recruiter-outreach/recruiter_outreach.jsonl"
store_file="${RECRUITER_OUTREACH_STORE_FILE:-$store_file_default}"
mkdir -p "$(dirname "$store_file")"

op_read_reference() {
  local reference="$1"

  if ! command -v op >/dev/null 2>&1; then
    echo "Error: op CLI is not installed" >&2
    return 1
  fi

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
  : 20_000;

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
  process.stderr.write(detail.length > 0 ? `${detail}\n` : `Error: op read exited with code ${status}\n`);
  process.exit(status);
}

process.stdout.write(result.stdout ?? '');
NODE
    return
  fi

  op --cache=false read "$reference"
}

sdk_read_reference() {
  local reference="$1"

  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node is required for SDK secret resolution" >&2
    return 1
  fi

  node - "$reference" <<'NODE'
const reference = process.argv[2];

(async () => {
  try {
    let sdk;
    try {
      sdk = await import('@1password/sdk');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: @1password/sdk is not available: ${message}\n`);
      process.exit(2);
      return;
    }

    const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      process.stderr.write('Error: OP_SERVICE_ACCOUNT_TOKEN is required for SDK resolution\n');
      process.exit(3);
      return;
    }

    const client = await sdk.createClient({
      auth: token,
      integrationName: 'personal-agent',
      integrationVersion: '1.0.0',
    });

    const value = await client.secrets.resolve(reference);
    if (typeof value !== 'string' || value.length === 0) {
      process.stderr.write('Error: SDK resolved an empty secret value\n');
      process.exit(4);
      return;
    }

    process.stdout.write(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: SDK failed to read secret: ${message}\n`);
    process.exit(1);
  }
})();
NODE
}

compact_error_text() {
  local raw="$1"
  printf '%s' "$raw" | tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

resolve_reference_value() {
  local reference="$1"
  local value=""
  local sdk_error=""
  local op_error=""
  local err_file=""

  case "$resolver_mode" in
    env-only)
      echo "Error: FASTMAIL_SECRET_RESOLVER=env-only cannot resolve $reference" >&2
      return 1
      ;;
    op-only)
      op_read_reference "$reference"
      return
      ;;
    sdk-only|auto|*)
      err_file="$(mktemp)"
      if value="$(sdk_read_reference "$reference" 2>"$err_file")" && [[ -n "$value" ]]; then
        rm -f "$err_file"
        printf '%s' "$value"
        return
      fi
      sdk_error="$(compact_error_text "$(cat "$err_file" 2>/dev/null || true)")"
      rm -f "$err_file"

      err_file="$(mktemp)"
      if value="$(op_read_reference "$reference" 2>"$err_file")" && [[ -n "$value" ]]; then
        rm -f "$err_file"
        printf '%s' "$value"
        return
      fi
      op_error="$(compact_error_text "$(cat "$err_file" 2>/dev/null || true)")"
      rm -f "$err_file"

      echo "Error: unable to resolve $reference via available secret resolvers. sdk_error=${sdk_error:-none}; op_error=${op_error:-none}" >&2
      return 1
      ;;
  esac
}

resolve_fastmail_password() {
  local candidate
  local value=""
  local -a refs=()
  local -a tried=()
  local -a resolve_errors=()

  candidate="${FASTMAIL_APP_PASSWORD:-}"
  if [[ -n "$candidate" ]]; then
    if [[ "$candidate" == op://* ]]; then
      resolve_reference_value "$candidate"
      return
    fi
    printf '%s' "$candidate"
    return
  fi

  candidate="${FASTMAIL_API_KEY:-}"
  if [[ -n "$candidate" ]]; then
    if [[ "$candidate" == op://* ]]; then
      resolve_reference_value "$candidate"
      return
    fi
    printf '%s' "$candidate"
    return
  fi

  if [[ -n "${FASTMAIL_API_KEY_OP_REF:-}" ]]; then
    refs+=("$FASTMAIL_API_KEY_OP_REF")
  fi
  if [[ -n "${FASTMAIL_APP_PASSWORD_OP_REF:-}" ]]; then
    refs+=("$FASTMAIL_APP_PASSWORD_OP_REF")
  fi

  if [[ ${#refs[@]} -eq 0 ]]; then
    refs+=("op://Assistant/FASTMAIL_API_KEY/password")
    refs+=("op://Assistant/FASTMAIL_APP_PASSWORD/password")
  fi

  local ref
  local err_file
  local err_text

  for ref in "${refs[@]}"; do
    if [[ " ${tried[*]} " == *" $ref "* ]]; then
      continue
    fi
    tried+=("$ref")

    err_file="$(mktemp)"
    if value="$(resolve_reference_value "$ref" 2>"$err_file")" && [[ -n "$value" ]]; then
      rm -f "$err_file"
      printf '%s' "$value"
      return
    fi
    err_text="$(compact_error_text "$(cat "$err_file" 2>/dev/null || true)")"
    rm -f "$err_file"
    resolve_errors+=("$ref => ${err_text:-unknown error}")
  done

  {
    echo "Error: unable to resolve Fastmail app password from env vars or 1Password references"
    echo "Tried references:"
    for err in "${resolve_errors[@]}"; do
      echo "- $err"
    done
  } >&2

  return 1
}

if ! fastmail_app_password="$(resolve_fastmail_password)"; then
  exit 1
fi

if [[ -z "$fastmail_app_password" ]]; then
  echo "Error: resolved Fastmail app password is empty" >&2
  exit 1
fi

FASTMAIL_RESOLVED_APP_PASSWORD="$fastmail_app_password" \
RECRUITER_OUTREACH_DAYS="${days:-}" \
RECRUITER_OUTREACH_BOOTSTRAP="$bootstrap" \
RECRUITER_OUTREACH_TIMEZONE="$report_timezone" \
RECRUITER_OUTREACH_STORE_FILE="$store_file" \
python3 - "$FASTMAIL_USERNAME" "$imap_host" "$imap_port" "$imap_timeout_seconds" <<'PY'
import imaplib
import json
import os
import re
import socket
import sys
from datetime import datetime, timedelta, timezone
from email import policy
from email.header import decode_header, make_header
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None


class ScriptError(Exception):
    pass


def fail(message: str) -> None:
    raise ScriptError(message)


def decode_header_value(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw))).strip()
    except Exception:
        return raw.strip()


def clean_text(raw: str, max_len: int = 240) -> str:
    compact = re.sub(r"\s+", " ", raw or "").strip()
    if len(compact) <= max_len:
        return compact
    return compact[: max_len - 1].rstrip() + "…"


def parse_fetch_parts(parts: list[object]) -> tuple[bytes, str, bytes]:
    header_bytes = b""
    internal_raw = ""
    body_bytes = b""

    for part in parts:
        if isinstance(part, tuple):
            meta = part[0] if len(part) > 0 else b""
            payload = part[1] if len(part) > 1 else b""

            if isinstance(meta, (bytes, bytearray)) and not internal_raw:
                match = re.search(rb'INTERNALDATE "([^"]+)"', bytes(meta))
                if match:
                    internal_raw = match.group(1).decode("utf-8", errors="replace")

            if isinstance(payload, (bytes, bytearray)):
                payload_bytes = bytes(payload)
                if b"Message-ID" in payload_bytes or b"Subject" in payload_bytes:
                    header_bytes += payload_bytes
                else:
                    body_bytes += payload_bytes
            continue

        if isinstance(part, (bytes, bytearray)) and not internal_raw:
            match = re.search(rb'INTERNALDATE "([^"]+)"', bytes(part))
            if match:
                internal_raw = match.group(1).decode("utf-8", errors="replace")

    return header_bytes, internal_raw, body_bytes


def parse_internal_date(raw: str, fallback: str) -> datetime:
    if raw:
        try:
            return datetime.strptime(raw, "%d-%b-%Y %H:%M:%S %z").astimezone(timezone.utc)
        except ValueError:
            pass

    if fallback:
        try:
            parsed = parsedate_to_datetime(fallback)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except Exception:
            pass

    return datetime.now(timezone.utc)


def resolve_company(email_addr: str, sender_name: str) -> str:
    domain = (email_addr.split("@", 1)[1].lower() if "@" in email_addr else "")
    if domain:
        for prefix in ("mail.", "email.", "jobs.", "careers."):
            if domain.startswith(prefix):
                domain = domain[len(prefix) :]
        root = domain.split(".")[0]
        if root and root not in {"gmail", "googlemail", "outlook", "hotmail", "yahoo", "proton"}:
            return root.replace("-", " ").replace("_", " ").title()

    return clean_text(sender_name or "Unknown", 80)


def recruiter_like(subject: str, sender: str, preview: str) -> bool:
    text = f"{subject} {sender} {preview}".lower()

    positive = [
        "recruiter",
        "recruiting",
        "talent",
        "sourcer",
        "headhunter",
        "hiring",
        "interview",
        "candidate",
        "candidacy",
        "application",
        "opportunity",
        "position",
        "role",
        "screen",
        "onsite",
        "take-home",
        "next step",
        "next steps",
    ]

    negative = [
        "receipt",
        "invoice",
        "order",
        "shipped",
        "delivery",
        "newsletter",
        "digest",
        "unsubscribe",
        "promotion",
        "sale",
        "webinar",
        "ticket",
        "statement",
        "bill",
        "password reset",
        "security alert",
        "verification code",
    ]

    score = sum(1 for token in positive if token in text)
    neg_score = sum(1 for token in negative if token in text)

    if "job alert" in text:
        neg_score += 2

    if "@linkedin.com" in text and "inmail" in text:
        score += 1

    if "recruiter" in sender.lower() or "talent" in sender.lower():
        score += 1

    if score < 2:
        return False

    if neg_score >= score + 1:
        return False

    return True


def compute_window(timezone_name: str, trailing_days: int | None) -> tuple[datetime, datetime, str]:
    if ZoneInfo is None:
        fail("zoneinfo is unavailable in this Python runtime")

    tz = ZoneInfo(timezone_name)
    now_local = datetime.now(tz)

    if trailing_days and trailing_days > 0:
        start_local = now_local - timedelta(days=trailing_days)
        end_local = now_local
        label = f"last {trailing_days} days"
    else:
        previous_day = now_local.date() - timedelta(days=1)
        start_local = datetime.combine(previous_day, datetime.min.time(), tz)
        end_local = start_local + timedelta(days=1)
        label = "previous local calendar day"

    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc), label


def load_existing_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()

    ids: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        record_id = str(record.get("id", "")).strip()
        if record_id:
            ids.add(record_id)
    return ids


def append_jsonl(path: Path, records: list[dict]) -> None:
    with path.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def overwrite_jsonl(path: Path, records: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


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
        fail("resolved Fastmail password was empty")

    timezone_name = os.environ.get("RECRUITER_OUTREACH_TIMEZONE", "America/New_York")
    days_raw = os.environ.get("RECRUITER_OUTREACH_DAYS", "").strip()
    trailing_days = int(days_raw) if days_raw.isdigit() else None
    bootstrap = os.environ.get("RECRUITER_OUTREACH_BOOTSTRAP", "0") == "1"
    store_file = Path(os.environ["RECRUITER_OUTREACH_STORE_FILE"]).expanduser()

    start_utc, end_utc, _window_label = compute_window(timezone_name, trailing_days)

    since_date = start_utc.strftime("%d-%b-%Y")
    before_date = (end_utc + timedelta(days=1)).strftime("%d-%b-%Y")

    store_file.parent.mkdir(parents=True, exist_ok=True)

    existing_ids = set() if bootstrap else load_existing_ids(store_file)
    existing_count = 0 if bootstrap else len(existing_ids)

    client: imaplib.IMAP4_SSL | None = None
    scanned_in_window = 0
    matched_records: list[dict] = []
    seen_ids_in_run: set[str] = set()

    try:
        socket.setdefaulttimeout(timeout_seconds)

        try:
            client = imaplib.IMAP4_SSL(host, port, timeout=timeout_seconds)
        except TypeError:
            client = imaplib.IMAP4_SSL(host, port)

        login_status, _ = client.login(username, password)
        if login_status != "OK":
            fail(f"IMAP login returned unexpected status {login_status}")

        for mailbox in ("INBOX", "Archive"):
            select_status, _ = client.select(mailbox, readonly=True)
            if select_status != "OK":
                continue

            search_status, search_parts = client.search(None, "SINCE", since_date, "BEFORE", before_date)
            if search_status != "OK" or not search_parts:
                continue

            message_ids = search_parts[0].split() if isinstance(search_parts[0], (bytes, bytearray)) else []
            for msg_id in message_ids:
                msg_id_text = msg_id.decode("utf-8", errors="replace")

                fetch_status, fetch_parts = client.fetch(
                    msg_id_text,
                    "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID SUBJECT FROM TO DATE)] BODY.PEEK[TEXT]<2048> INTERNALDATE)",
                )
                if fetch_status != "OK" or not fetch_parts:
                    continue

                header_bytes, internal_raw, body_bytes = parse_fetch_parts(fetch_parts)
                headers = BytesParser(policy=policy.default).parsebytes(header_bytes)

                message_id_header = decode_header_value(headers.get("Message-ID"))
                subject = decode_header_value(headers.get("Subject"))
                from_header = decode_header_value(headers.get("From"))
                to_header = decode_header_value(headers.get("To"))
                date_header = decode_header_value(headers.get("Date"))
                preview = clean_text(body_bytes.decode("utf-8", errors="replace"), 240)

                received_at_dt = parse_internal_date(internal_raw, date_header)
                if received_at_dt < start_utc or received_at_dt >= end_utc:
                    continue

                scanned_in_window += 1

                if not recruiter_like(subject, from_header, preview):
                    continue

                recruiter_name, recruiter_email = parseaddr(from_header)
                recruiter_name = clean_text(recruiter_name or recruiter_email or "Unknown", 80)
                recruiter_email = recruiter_email.strip().lower()
                company = resolve_company(recruiter_email, recruiter_name)

                stable_id = message_id_header.strip() or f"{mailbox}:{msg_id_text}:{received_at_dt.isoformat()}"
                if stable_id in seen_ids_in_run:
                    continue
                seen_ids_in_run.add(stable_id)

                matched_records.append(
                    {
                        "id": stable_id,
                        "thread_id": stable_id,
                        "subject": subject,
                        "received_at": received_at_dt.isoformat(),
                        "recruiter_name": recruiter_name,
                        "recruiter_email": recruiter_email,
                        "company": company,
                        "role_hint": clean_text(subject, 120),
                        "preview": preview,
                        "from": from_header,
                        "to": to_header,
                        "source": "Fastmail/IMAP",
                        "recorded_at": datetime.now(timezone.utc).isoformat(),
                    }
                )

        matched_records.sort(key=lambda item: item.get("received_at", ""))

        if bootstrap:
            write_records = matched_records
            overwrite_jsonl(store_file, write_records)
            new_records = write_records
            total_tracked = len(write_records)
        else:
            new_records = [record for record in matched_records if record["id"] not in existing_ids]
            append_jsonl(store_file, new_records)
            total_tracked = existing_count + len(new_records)

        print("# Recruiter Outreach Sync")
        print(f"Window: {start_utc.isoformat()} -> {end_utc.isoformat()}")
        print("Transport: imap")
        print(f"Scanned messages in window: {scanned_in_window}")
        print(f"Matched recruiter-like messages: {len(matched_records)}")
        print(f"New records added: {len(new_records)}")
        print(f"Total tracked records: {total_tracked}")
        print(f"Store file: {store_file}")
        print()

        for record in new_records[:15]:
            when = record.get("received_at", "")
            company = record.get("company", "Unknown")
            recruiter = record.get("recruiter_name", "Unknown")
            role = record.get("role_hint", "") or record.get("subject", "")
            print(f"- {when} | {company} | {recruiter} | {role}")

        if not new_records:
            print("- No new recruiter records in this window")

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
