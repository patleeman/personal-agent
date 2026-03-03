---
name: subagent-code-review
description: Instructions on performing a code review with a subagent.
---

# Code Review Sub-Agent

Spawn yourself as a sub-agent via bash to do a code review: $@

Use `pa -p` with appropriate arguments. If the user specifies a model,
use `--provider` and `--model` accordingly.

Pass a prompt to the sub-agent asking it to review the code for:
- Bugs and logic errors
- Security issues
- Error handling gaps

Do not read the code yourself. Let the sub-agent do that.

Report the sub-agent's findings.
