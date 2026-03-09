---
id: assistant-memory-maintenance
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
Run a unified memory-maintenance pass for the **assistant** profile.

Scope:
- Only update files under `profiles/assistant/agent/**`.
- Do not edit any other profile's AGENTS, skills, memory, state, or task files.

Read first:
- `profiles/assistant/agent/memory/conversation-maintenance.md`

Authoritative files:
- Processed index (JSON): `profiles/assistant/agent/state/conversation-maintenance/processed-conversations.json`
- Run log (markdown): `profiles/assistant/agent/memory/conversation-maintenance-runs.md`
- Sessions root: `~/.local/state/personal-agent/pi-agent/sessions`

Execution requirements:
1. Use timezone `America/New_York`.
2. Generate the unprocessed-session list by running exactly:
   - `node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile assistant --index profiles/assistant/agent/state/conversation-maintenance/processed-conversations.json --days 7 --timezone America/New_York`
3. Treat the script JSON output as source of truth.
   - If `index.parseError` is present, report failure and stop.
4. Run a profile-scoped memory hygiene pass whether or not there are unprocessed conversations.
   - Inspect `profiles/assistant/agent/AGENTS.md`.
   - Inspect relevant `profiles/assistant/agent/skills/**` files.
   - Inspect relevant `profiles/assistant/agent/memory/**/*.md` files.
   Goals:
   - Remove instructions/facts that are no longer true.
   - Remove redundancy and contradictions.
   - Remove low-value/noisy bullets that do not improve future behavior.
   - Keep `AGENTS.md` high-level (durable user facts, durable role constraints, broad operating policy).
   - Move reusable workflow/tool-specific details into skills.
   - Move project/profile-specific details into memory docs.
   - Condense overlapping bullets into fewer, higher-signal bullets when they describe one cohesive policy.
   - Preserve durable, still-true constraints and preferences.
   - Only keep high-quality information that is specific, durable, and likely to improve future behavior.
   - Do not invent new personal or project facts.
5. Conversation processing:
   - If `counts.unprocessedInWindow == 0`, skip conversation tracking updates and continue with any needed hygiene-only edits.
   - Otherwise review unprocessed conversations in oldest-first order.
   - Process all returned unprocessed sessions unless there are more than 20; in that case process the first 20 and leave explicit backlog count.
   - Only promote information when it is high-signal, clearly useful, and high-confidence.
   - Do not store transient chatter, speculative claims, weak inferences, session-only details, or one-off instructions that are unlikely to matter later.
   - Repeated task patterns → update/add profile skills if genuinely reusable.
   - Durable profile behavior/facts → update `profiles/assistant/agent/AGENTS.md` (high-level only).
   - Project-specific insights → update relevant `profiles/assistant/agent/memory/**/*.md` files.
6. If any sessions were processed, update `profiles/assistant/agent/state/conversation-maintenance/processed-conversations.json` by upserting one record per processed session:
   - required: `sessionId`, `sessionFile`, `sessionTimestamp`, `sessionDateLocal`, `processedAt`
   - optional: `summary` (one line), `result` (`updated` or `no-change`)
   - preserve existing extra fields when present
   - update top-level `updatedAt`
   - keep unique by `sessionId`
7. If any sessions were processed, append one run-log line to `profiles/assistant/agent/memory/conversation-maintenance-runs.md`:
   - `run=<ISO-8601> | window=<YYYY-MM-DD..YYYY-MM-DD> | processed=<count> | remaining=<count> | changed=<yes|no>`
8. For conversation tracking artifacts, update only:
   - `profiles/assistant/agent/state/conversation-maintenance/processed-conversations.json`
   - `profiles/assistant/agent/memory/conversation-maintenance-runs.md`
9. Keep edits minimal, correct, and scoped to assistant profile files.
10. Git requirements:
   - If no files changed after the hygiene pass and conversation processing, report `No memory-maintenance changes needed.` and stop.
   - If files changed:
     - Stage only files changed for this run within:
       - `profiles/assistant/agent/state/conversation-maintenance/**`
       - intentionally updated `profiles/assistant/agent/memory/**`
       - intentionally updated `profiles/assistant/agent/AGENTS.md`
       - intentionally updated `profiles/assistant/agent/skills/**`
     - Do **not** stage unrelated repo changes.
     - Commit message: `chore(assistant): memory maintenance <YYYY-MM-DD>`
     - Push to origin.
     - If push fails, report exact error and stop.
11. If a commit is created, include the commit SHA in the final status.

Output:
- Short status with processed count, remaining count, files updated, hygiene summary, and commit result.
