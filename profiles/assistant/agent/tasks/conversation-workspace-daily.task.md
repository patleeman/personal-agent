---
id: assistant-conversation-workspace-daily
enabled: true
cron: "11 */3 * * *"
profile: "assistant"
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
Run a conversation-retrospective maintenance pass for the **assistant** profile.

Read first:
- `profiles/assistant/agent/workspace/projects/conversation-maintenance/PROJECT.md`

Authoritative files:
- Processed index (JSON): `profiles/assistant/agent/workspace/projects/conversation-maintenance/notes/processed-conversations.json`
- Run log (markdown): `profiles/assistant/agent/workspace/projects/conversation-maintenance/notes/processed-days.md`
- Sessions root: `~/.local/state/personal-agent/pi-agent/sessions`

Execution requirements:
1. Use timezone `America/New_York`.
2. Generate the unprocessed-session list by running exactly:
   - `node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile assistant --index profiles/assistant/agent/workspace/projects/conversation-maintenance/notes/processed-conversations.json --days 7 --timezone America/New_York`
3. Treat the script JSON output as source of truth.
   - If `index.parseError` is present, report failure and stop.
   - If `counts.unprocessedInWindow == 0`, report `No unprocessed conversations in the last 7 days.` and stop without edits.
4. Review unprocessed conversations in oldest-first order.
   - Process all returned unprocessed sessions unless there are more than 20; in that case process the first 20 and leave explicit backlog count.
   - Repeated task patterns → update/add profile skills if genuinely reusable.
   - Durable profile behavior/facts → update `profiles/assistant/agent/AGENTS.md` (high-level only).
   - Project-specific insights → update relevant workspace project docs.
5. Update `processed-conversations.json` by upserting one record per processed session:
   - required: `sessionId`, `sessionFile`, `sessionTimestamp`, `sessionDateLocal`, `processedAt`
   - optional: `summary` (one line), `result` (`updated` or `no-change`)
   - preserve existing extra fields when present
   - update top-level `updatedAt`
   - keep unique by `sessionId`
6. Append one run-log line to `processed-days.md`:
   - `- run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | changed=<yes|no>`
7. For tracking artifacts, update only:
   - `processed-conversations.json`
   - `processed-days.md`
8. Keep edits minimal, correct, and scoped to assistant profile memory/workspace files.
9. Git requirements:
   - If no files changed after review, report `No conversation-maintenance changes needed.` and stop.
   - If files changed:
     - Stage only files changed for this run within:
       - `profiles/assistant/agent/workspace/projects/conversation-maintenance/**`
       - intentionally updated `profiles/assistant/agent/AGENTS.md`
       - intentionally updated `profiles/assistant/agent/skills/**`
       - intentionally updated `profiles/assistant/agent/workspace/projects/**`
     - Do **not** stage unrelated repo changes.
     - Commit message: `chore(assistant): conversation maintenance <YYYY-MM-DD>`
     - Push to origin.
     - If push fails, report exact error and stop.
10. If a commit is created, include the commit SHA in the final status.

Output:
- Short status with processed count, remaining count, files updated, and commit result.
