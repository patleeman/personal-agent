---
id: datadog-memory-maintenance
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
Run a unified memory-maintenance pass for the **datadog** profile.

Scope:
- Only update repo-managed files under `profiles/datadog/agent/**`.
- You may also update the runtime processed index file reported by the selector script `indexPath` field.
- Do not edit any other profile's AGENTS, skills, memory, state, or task files.

Authoritative files:
- Processed index (JSON): use the selector script output `indexPath` field (default runtime path: `~/.local/state/personal-agent/conversation-maintenance/datadog/processed-conversations.json`)
- Sessions root: `~/.local/state/personal-agent/pi-agent/sessions`

Execution requirements:
1. Use timezone `America/New_York`.
2. Generate the unprocessed-session list by running exactly:
   - `node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile datadog --days 7 --timezone America/New_York`
3. Treat the script JSON output as source of truth.
   - Use the reported `indexPath` as the authoritative processed-index file to update for this run.
   - If `index.parseError` is present, report failure and stop.
4. Run a profile-scoped memory hygiene pass whether or not there are unprocessed conversations.
   - Inspect `profiles/datadog/agent/AGENTS.md`.
   - Inspect relevant `profiles/datadog/agent/skills/**` files.
   - Inspect relevant `profiles/datadog/agent/memory/**/*.md` files.
   Goals:
   - Remove instructions/facts that are no longer true.
   - Remove redundancy and contradictions.
   - Remove low-value/noisy bullets that do not improve future behavior.
   - Keep `AGENTS.md` high-level (durable profile facts, durable role constraints, broad operating policy).
   - Move reusable workflow/tool-specific details into skills.
   - Move project/profile-specific details into memory docs.
   - Condense overlapping bullets into fewer, higher-signal bullets when they describe one cohesive policy.
   - Preserve durable, still-true constraints and preferences.
   - Only keep high-quality information that is specific, durable, and likely to improve future behavior.
   - Do not invent new profile or project facts.
5. Conversation processing:
   - If `counts.unprocessedInWindow == 0`, skip conversation tracking updates and continue with any needed hygiene-only edits.
   - Otherwise review unprocessed conversations in oldest-first order.
   - Process all returned unprocessed sessions unless there are more than 20; in that case process the first 20 and leave explicit backlog count.
   - Only promote information when it is high-signal, clearly useful, and high-confidence.
   - Do not store transient chatter, speculative claims, weak inferences, session-only details, or one-off instructions that are unlikely to matter later.
   - Repeated Datadog workflows → update/add `profiles/datadog/agent/skills/*` when genuinely reusable.
   - Durable profile behavior/facts → update `profiles/datadog/agent/AGENTS.md` (high-level only).
   - Project-specific Datadog insights → update relevant `profiles/datadog/agent/memory/**/*.md` files.
6. If any sessions were processed, update the processed index at the selector output `indexPath` by upserting one record per processed session:
   - required: `sessionId`, `sessionFile`, `sessionTimestamp`, `sessionDateLocal`, `processedAt`
   - optional: `summary` (one line), `result` (`updated` or `no-change`)
   - preserve existing extra fields when present
   - update top-level `updatedAt`
   - keep unique by `sessionId`
7. For conversation tracking artifacts, update only the processed index at the selector output `indexPath`.
8. Keep edits minimal, correct, and scoped to datadog profile files plus the resolved runtime processed index.
9. Git requirements:
   - If no files changed after the hygiene pass and conversation processing, report `No memory-maintenance changes needed.` and stop.
   - If files changed:
     - Stage only repo-managed files changed for this run within:
       - intentionally updated `profiles/datadog/agent/memory/**`
       - intentionally updated `profiles/datadog/agent/AGENTS.md`
       - intentionally updated `profiles/datadog/agent/skills/**`
     - Do **not** stage unrelated repo changes.
     - Commit message: `chore(datadog): memory maintenance <YYYY-MM-DD>`
     - Push to origin.
     - If push fails, report exact error and stop.
10. If a commit is created, include the commit SHA in the final status.

Output:
- Short status with processed count, remaining count, files updated, hygiene summary, and commit result.
