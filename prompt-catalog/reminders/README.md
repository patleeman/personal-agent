# Reminder review

This directory holds reminder-style prompt text used when conditional guidance is better than permanent prompt mass.

Current reminder candidates and decisions:

- `memory-operations.md` — **implemented** as a hidden reminder for memory-specific requests.
- `code-references.md` — available as a reminder candidate; related guidance is also present in the active shared system sections.
- `delegation.md` — available as a reminder candidate for future subagent/durable-run follow-up hooks.

Use reminders when:
- the instruction is only relevant for a subset of requests
- the guidance is high value but too verbose to keep always-on
- the reminder depends on recent task state or a specific user intent

Prefer always-on prompt sections when:
- the rule should shape nearly every coding/task response
- the rule defines stable role, scope, or output style
- omitting it would regularly degrade behavior
