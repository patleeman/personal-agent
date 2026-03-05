---
name: subagent
description: Run a generic subagent in detached tmux sessions via `pa tmux run` + `pa -p` to delegate focused work, isolate noisy tasks, or parallelize independent investigations.
allowed-tools: Bash(pa:*), Bash(mktemp:*), Bash(cat:*)
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
3. Launch each subagent with `pa tmux run <task-slug> -- pa -p ...`.
4. Confirm startup with `pa tmux list`.
5. Send kickoff/progress/completion updates with session name, state, latest output, and next action.
6. Validate important claims before reporting back.
7. Return only a concise synthesis, not raw noisy logs.
8. Stop completed sessions with `pa tmux stop <session>` unless the user asks to keep them.
9. Clean stale logs with `pa tmux clean` when appropriate.

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
task_slug="<task-slug>" # kebab-case
prompt_file="$(mktemp /tmp/${task_slug}.prompt.XXXX.md)"

cat >"$prompt_file" <<'EOF'
<subagent prompt>
EOF

pa tmux run "$task_slug" -- pa -p "$(cat "$prompt_file")"
pa tmux list
```

### With model override

```bash
pa tmux run "$task_slug" -- pa --provider <provider> --model <model> -p "$(cat "$prompt_file")"
pa tmux list
```

### Parallel subagents (independent tasks)

```bash
# Write prompts first: $prompt_a, $prompt_b
pa tmux run "<task-a-slug>" -- pa -p "$(cat "$prompt_a")"
pa tmux run "<task-b-slug>" -- pa -p "$(cat "$prompt_b")"

pa tmux list
```

### Monitoring and cleanup

```bash
pa tmux list
pa tmux logs <session> --tail 80

# after completion
pa tmux stop <session>
pa tmux clean --dry-run
pa tmux clean
```

## Safety rules

- Never pass secrets, credentials, or tokens in prompts.
- Ask before destructive operations (deletes, force pushes, infra changes).
- Parent agent is responsible for final verification and user-facing summary.
