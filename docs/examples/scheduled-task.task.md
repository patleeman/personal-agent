---
id: daily-status
title: Daily status summary
enabled: true
cron: "0 9 * * 1-5"
profile: "shared"
model: "openai-codex/gpt-5.4"
cwd: "~/project"
timeoutSeconds: 1800
---
Summarize the last day of work in this repo.

Return:
1. What changed
2. Risks or blockers
3. The next three priorities
