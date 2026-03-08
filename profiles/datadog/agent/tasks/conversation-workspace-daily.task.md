---
id: datadog-conversation-workspace-daily
enabled: true
cron: "41 */3 * * *"
profile: "datadog"
model: "openai-codex/gpt-5.4"
cwd: "/Users/patrick/workingdir/personal-agent"
timeoutSeconds: 2700
output:
  when: failure
  targets:
    - gateway: telegram
      chatId: "-1003854487728"
      messageThreadId: 22
---
Run a conversation-retrospective maintenance pass for the **datadog** profile.

Read first:
- `profiles/datadog/agent/workspace/projects/conversation-maintenance/PROJECT.md`

Authoritative files:
- Processed index (JSON): `profiles/datadog/agent/workspace/projects/conversation-maintenance/notes/processed-conversations.json`
- Run log (markdown): `profiles/datadog/agent/workspace/projects/conversation-maintenance/notes/processed-days.md`
- Daily notes dir: `profiles/datadog/agent/workspace/projects/conversation-maintenance/notes/daily`
- Sessions root: `~/.local/state/personal-agent/pi-agent/sessions`

Execution requirements:
1. Use timezone `America/New_York`.
2. Generate the unprocessed-session list by running exactly:
   - `node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile datadog --index profiles/datadog/agent/workspace/projects/conversation-maintenance/notes/processed-conversations.json --days 7 --timezone America/New_York`
3. Treat the script JSON output as source of truth.
   - If `index.parseError` is present, report failure and stop.
   - If `counts.unprocessedInWindow == 0`, report `No unprocessed conversations in the last 7 days.` and stop without edits.
4. Review unprocessed conversations in oldest-first order.
   - Process all returned unprocessed sessions unless there are more than 20; in that case process the first 20 and leave explicit backlog count.
   - Repeated Datadog workflows → update/add `profiles/datadog/agent/skills/*` when genuinely reusable.
   - Durable profile behavior/facts → update `profiles/datadog/agent/AGENTS.md` (high-level only).
   - Project-specific Datadog insights → update relevant workspace project docs.
5. Write or append `notes/daily/<YYYY-MM-DD>.md` (today’s local date) including:
   - run timestamp and scanned window
   - processed session IDs/files
   - key insights
   - files changed (or `none`)
   - remaining unprocessed count in window
6. Update `processed-conversations.json` by upserting one record per processed session:
   - `sessionId`, `sessionFile`, `sessionTimestamp`, `sessionDateLocal`, `processedAt`, `note`
   - optional short `summary` (one line)
   - update top-level `updatedAt`
   - keep unique by `sessionId`
7. Append one run-log line to `processed-days.md`:
   - `- run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | note=notes/daily/<YYYY-MM-DD>.md`
8. Keep edits minimal, correct, and scoped to datadog profile memory/workspace files.

Output:
- Short status with processed count, remaining count, and files updated.
