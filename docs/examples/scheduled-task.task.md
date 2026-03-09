---
id: daily-status
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
model: "openai-codex/gpt-5.4"
cwd: "~/agent-workspace"
timeoutSeconds: 1800
runInTmux: true
output:
  when: success
  targets:
    - gateway: telegram
      chatId: "123456789"
      messageThreadId: 22
---
Summarize yesterday's work from git history and open TODOs.
Return:
1) What changed
2) Risks/blockers
3) Top 3 priorities for today
