---
id: recruiter-outreach-daily
enabled: true
cron: "0 2 * * *"
profile: "assistant"
model: "openai-codex/gpt-5.4"
cwd: "/Users/patrick/agent-workspace"
timeoutSeconds: 1200
output:
  when: always
  targets:
    - gateway: telegram
      chatId: "-1003854487728"
      messageThreadId: 22
---
Scan the previous calendar day for new recruiter-outreach emails and update the workspace list.

Run exactly this command from shell and then report a concise summary of its output:

`FASTMAIL_SECRET_RESOLVER="sdk-only" FASTMAIL_API_KEY_OP_REF="op://Assistant/FASTMAIL_API_KEY/password" FASTMAIL_APP_PASSWORD_OP_REF="op://Assistant/FASTMAIL_API_KEY/password" FASTMAIL_USERNAME="me@patricklee.nyc" /Users/patrick/agent-workspace/recruiter-outreach/scripts/recruiter-outreach.sh`

- Keep the response concise.
- Include whether new records were added and any likely company/recruiter highlights.
- If there is an error, include the exact failure reason and do not suppress it.
