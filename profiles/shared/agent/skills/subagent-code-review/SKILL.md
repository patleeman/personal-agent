---
name: subagent-code-review
description: Run a code-review subagent via `pa runs start` and report its findings.
allowed-tools: Bash(pa:*), Bash(mktemp:*), Bash(cat:*)
---

# Code Review Subagent

Use a subagent for code review. Do not perform the detailed review yourself.

## Workflow

1. Define review scope (branch, commit range, or file list).
2. Build a prompt that asks for:
   - Bugs and logic errors
   - Security issues
   - Error handling gaps
   - Missing tests/regression risks
3. Launch the reviewer with `pa runs start code-review -- pa -p ...`.
4. Confirm startup with `pa runs list` and report kickoff status.
5. Monitor via `pa runs logs <run-id>` and report findings by severity with file paths and fixes.
6. Cancel the run with `pa runs cancel <run-id>` if it should stop early.

## Command pattern

```bash
prompt_file="$(mktemp /tmp/code-review.prompt.XXXX.md)"

cat >"$prompt_file" <<'EOF'
Review the requested scope for:
- Bugs and logic errors
- Security issues
- Error handling gaps
- Missing tests/regression risks

Return:
- status
- prioritized findings
- affected files
- suggested fixes
- residual risks
EOF

pa runs start code-review -- pa -p "$(cat "$prompt_file")"
pa runs list
```

### With model override

```bash
pa runs start code-review -- pa --provider <provider> --model <model> -p "$(cat "$prompt_file")"
pa runs list
```

### Monitoring and cleanup

```bash
pa runs logs <run-id> --tail 120

# stop early if needed
pa runs cancel <run-id>
```

Report the subagent's findings.
