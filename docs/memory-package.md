# Memory Package

## Goal

`@personal-agent/memory` provides durable, searchable local memory using [`qmd`](https://github.com/tobi/qmd).

It should run as a **module inside `personal-agentd`**, not as a standalone daemon.

---

## Path conventions (aligned)

- Config: `~/.config/personal-agent/daemon.json` (memory section)
- Generated summaries/state: `~/.local/state/personal-agent/memory/`
- qmd cache/index: `~/.cache/qmd/`

---

## Sources to index

### 1) Past Pi conversations

Create a qmd collection for generated conversation summaries:

```bash
qmd collection add ~/.local/state/personal-agent/memory/conversations --name conversations
qmd context add qmd://conversations "Summaries of previous Pi sessions, decisions, fixes, and follow-ups"
```

Important: index **summaries**, not raw session logs with tool payloads.

### 2) Markdown notes (machine/context specific)

Examples:

- `notes-work`
- `notes-personal`

```bash
qmd collection add ~/work/notes --name notes-work
qmd collection add ~/personal/notes --name notes-personal
```

### 3) Other recommended sources

- runbooks / incident notes
- architecture and design docs
- PR/checkpoint summaries
- troubleshooting notes
- meeting notes and decision logs

Avoid:

- raw shell history
- raw tool payload transcripts
- generated/vendor-heavy directories

---

## Conversation indexing strategy

Use a two-step pipeline:

1. Parse session events and build a cleaned transcript
2. Generate a structured markdown summary
3. Index summary markdown with qmd

### Cleaned transcript rules

Include:

- user turns
- assistant turns
- compact action metadata (tool name, file path, command)

Exclude:

- raw tool request/response blobs
- large command output dumps
- binary/blob-like content

---

## Event-driven flow (via daemon)

1. client emits `session.updated` / `session.closed`
2. memory module resolves session and computes fingerprint
3. unchanged sessions are skipped
4. changed sessions regenerate summary markdown
5. mark index dirty
6. daemon schedules debounced indexing:
   - `qmd update`
   - `qmd embed` on slower cadence

No manual indexing should be required.

---

## qmd lifecycle note

`qmd collection add` registers a collection. It does **not** continuously watch and index changes.

Freshness should come from daemon scheduling (`qmd update` + periodic `qmd embed`).

---

## Memory config section (draft)

```json
{
  "modules": {
    "memory": {
      "enabled": true,
      "sessionSource": "~/.local/state/personal-agent/pi-agent/sessions",
      "summaryDir": "~/.local/state/personal-agent/memory/conversations",
      "collections": [
        {
          "name": "conversations",
          "path": "~/.local/state/personal-agent/memory/conversations",
          "mask": "**/*.md"
        },
        {
          "name": "notes-work",
          "path": "~/work/notes",
          "mask": "**/*.md"
        }
      ],
      "summarization": {
        "maxTurns": 200,
        "includeToolMetadata": true,
        "redactSecrets": true
      },
      "qmd": {
        "index": "default",
        "updateDebounceSeconds": 45,
        "embedDebounceSeconds": 600
      }
    }
  }
}
```

---

## MVP

1. Consume session events from daemon
2. Generate idempotent per-session summaries
3. Ensure qmd collections exist
4. Debounced `qmd update` + periodic `qmd embed`
5. Expose memory status in daemon diagnostics
