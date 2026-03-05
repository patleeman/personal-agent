---
name: subagent-code-review
description: Run a code-review subagent via `pa tmux run` and report its findings.
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
3. Launch the reviewer with `pa tmux run code-review -- pa -p ...`.
4. Confirm startup with `pa tmux list` and report kickoff status.
5. Monitor via `pa tmux logs <session>` and report findings by severity with file paths and fixes.
6. Stop the session with `pa tmux stop <session>` when done unless the user asks to keep it.
7. Periodically clean stale logs using `pa tmux clean`.

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

pa tmux run code-review -- pa -p "$(cat "$prompt_file")"
pa tmux list
```

### With model override

```bash
pa tmux run code-review -- pa --provider <provider> --model <model> -p "$(cat "$prompt_file")"
pa tmux list
```

### Monitoring and cleanup

```bash
pa tmux logs <session> --tail 120

# after completion
pa tmux stop <session>
pa tmux clean --dry-run
pa tmux clean
```

Report the subagent's findings.
