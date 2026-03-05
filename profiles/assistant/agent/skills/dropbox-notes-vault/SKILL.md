---
name: dropbox-notes-vault
description: Locate, search, and map Patrick's Dropbox Notes vault. Use when asked to find/summarize personal notes, interview notes, writing, finance, fitness, or historical archived notes.
---

# Dropbox Notes Vault

Primary notes root:
- `/Users/patrick/Library/CloudStorage/Dropbox/Notes`

## Observed patterns

- The vault is topic-organized at top level (e.g., `AI`, `Business Ideas`, `Fitness`, `Finance`, `Writing`, `Software Engineering`, `43 Chadwick Road`).
- Historical material is concentrated in `!Archive` (majority of files).
- `.obsidian` is vault metadata/config; do not treat it as note content.
- `.trash` contains parked/older notes; include only when explicitly useful.
- Content is mixed-format (many PDFs/images/docs), but note discovery should start with Markdown (`.md`).
- `attachments/` folders appear under some topic areas (notably `Business Ideas`, `Fitness`, `Writing`).

## Default retrieval strategy

1. Start in active notes only:
   - include: topical folders and root `.md` notes
   - exclude by default: `!Archive`, `.obsidian`, `.trash`
2. Search Markdown first.
3. If not found, broaden to `!Archive`.
4. Return concise results with exact relative paths and short snippets.

## Scripts

Use bundled scripts for deterministic lookups:

```bash
# Map vault structure and file-type patterns
./scripts/notes-map.sh

# Search markdown notes (active notes only by default)
./scripts/notes-find.sh "interview prep"

# Include archive in search
./scripts/notes-find.sh "OpenAI" --include-archive
```

## Notes

- If user asks for "recent" notes, prioritize newest `.md` files in active folders before archive.
- If user asks for "all history" or old material, include `!Archive` immediately.
