---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
model: "openai-codex/gpt-5.3-codex"
cwd: "~/agent-workspace"
timeoutSeconds: 1800
output:
  when: success
  targets:
    - gateway: telegram
      chatId: "123456789"
---
Summarize yesterday's work from git history and open TODOs.
Return:
1) What changed
2) Risks/blockers
3) Top 3 priorities for today
