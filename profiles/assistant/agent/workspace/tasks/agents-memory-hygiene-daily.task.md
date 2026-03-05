---
id: agents-memory-hygiene-daily
enabled: true
cron: "15 3 * * *"
profile: "assistant"
model: "openai-codex/gpt-5.3-codex"
cwd: "/Users/patrick/workingdir/personal-agent"
timeoutSeconds: 1800
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "1191448898"
---
Run a daily AGENTS.md hygiene pass across profile memory files.

Scope:
- Every existing `profiles/*/agent/AGENTS.md` file.
- Do not edit non-AGENTS files in this task.

Goals:
- Remove instructions/facts that are no longer true.
- Remove redundancy and contradictions.
- Remove low-value/noisy bullets that do not improve future behavior.
- Reorganize each file into clean, logical sections with concise bullets.
- Preserve durable, still-true constraints and preferences.
- Do not invent new personal facts.

Execution requirements:
1. Inspect current AGENTS files and make high-signal edits only.
2. Keep tone clear and operational (not verbose).
3. After edits, review diff to ensure only AGENTS.md files changed.

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
