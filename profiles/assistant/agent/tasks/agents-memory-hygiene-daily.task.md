---
id: agents-memory-hygiene-daily
enabled: true
cron: "15 3 * * *"
profile: "assistant"
model: "openai-codex/gpt-5.4"
cwd: "/Users/patrick/workingdir/personal-agent"
timeoutSeconds: 1800
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "-5175615289"
---
Run a daily AGENTS.md hygiene pass across profile memory files.

Scope:
- Every existing `profiles/*/agent/AGENTS.md` file.
- When needed, also update related skill or project workspace docs to move misplaced detailed guidance out of AGENTS.

Goals:
- Remove instructions/facts that are no longer true.
- Remove redundancy and contradictions.
- Remove low-value/noisy bullets that do not improve future behavior.
- Keep AGENTS.md high-level (durable user facts, durable role constraints, broad operating policy).
- Move reusable workflow/tool-specific details into skills.
- Move project/repo-specific details into profile workspace project docs.
- Condense related bullets into fewer, higher-signal bullets when they describe one cohesive policy.
  - Example pattern to condense: separate `op` install/auth/runtime secret/launchd bullets should usually become 1–2 compact bullets.
- Treat section structure as fluid: create, merge, split, rename, or remove sections/subsections as needed for clarity.
- Preserve durable, still-true constraints and preferences.
- Do not invent new personal facts.

Execution requirements:
1. Inspect current AGENTS files and make high-signal edits only.
2. Keep tone clear and operational (not verbose).
3. For any AGENTS line that is workflow-heavy, tool/version-specific, or project-specific:
   - remove it from AGENTS
   - migrate it to an appropriate skill or project workspace document in the same change
4. Merge overlapping bullets that can be expressed more compactly without losing operational meaning.
5. After edits, review diff to ensure only intended AGENTS/skills/project-doc files changed.

Git requirements:
- If no AGENTS.md changes are needed, report `No AGENTS.md changes needed today.` and stop.
- If changes exist:
  - stage only the changed `AGENTS.md` files
  - commit with message: `chore: daily AGENTS.md hygiene`
  - push to origin
- If push fails, report exact error and do not continue.

Output requirements:
- Report which AGENTS.md files changed.
- Summarize what was removed/reorganized.
- Include commit SHA when a commit is created.
