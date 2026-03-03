---
name: subagent
description: Run a generic subagent via `pa -p` to delegate focused work, isolate noisy tasks, or parallelize independent investigations.
allowed-tools: Bash(pa:*), Bash(mktemp:*)
---

# Subagent

Delegate focused work to a separate agent process (invoked via `pa`) and return a concise synthesized result.

## Use this skill when

- User explicitly asks for a subagent.
- The task is noisy (browser automation, very long logs, large search output).
- You can split work into independent threads.

## Avoid this skill when

- The task is a short direct command/edit.
- The task requires tight interactive back-and-forth with the user.

## Workflow

1. Define a precise sub-task and acceptance criteria.
2. Write a constrained subagent prompt (task, context, constraints, expected output).
3. Run `pa -p` (and `--provider` / `--model` when user specifies a model).
4. For independent tasks, run multiple subagents in parallel.
5. Validate important claims before reporting back.
6. Return only a concise synthesis, not raw noisy logs.

## Subagent prompt template

```text
You are a focused subagent.

Task:
- <exact objective>

Context:
- Repository/CWD: <path>
- Important files: <paths>
- Constraints: <must-follow rules>

Execution rules:
- Complete the task end-to-end without asking the user questions.
- If blocked, explain the exact blocker and attempted steps.

Output contract:
- status: success | blocked | failed
- summary: 3-7 bullets
- artifacts: files changed/created
- checks: commands run and outcomes
- risks: remaining concerns
```

## Command patterns

### Single subagent

```bash
pa -p "$(cat <<'EOF'
<subagent prompt>
EOF
)"
```

### With model override

```bash
pa --provider <provider> --model <model> -p "$(cat <<'EOF'
<subagent prompt>
EOF
)"
```

### Parallel subagents

```bash
log_a="$(mktemp /tmp/subagent-a.XXXX.log)"
log_b="$(mktemp /tmp/subagent-b.XXXX.log)"

pa -p "<prompt A>" >"$log_a" 2>&1 &
pid_a=$!

pa -p "<prompt B>" >"$log_b" 2>&1 &
pid_b=$!

wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
```

## Safety rules

- Never pass secrets, credentials, or tokens in prompts.
- Ask before destructive operations (deletes, force pushes, infra changes).
- Parent agent is responsible for final verification and user-facing summary.
