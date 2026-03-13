---
name: subagent
description: Run a generic subagent as a daemon-backed durable background run via `pa runs start` + `pa -p` to delegate focused work, isolate noisy tasks, or parallelize independent investigations.
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
3. Launch each subagent with `pa runs start <task-slug> -- pa -p ...`.
4. Confirm startup with `pa runs list`.
5. Send kickoff/progress/completion updates with run id, state, latest output, and next action.
6. Validate important claims before reporting back.
7. Return only a concise synthesis, not raw noisy logs.
8. Cancel a run with `pa runs cancel <run-id>` if it should stop early.
9. Inspect logs with `pa runs logs <run-id>` when appropriate.

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

pa runs start "$task_slug" -- pa -p "$(cat "$prompt_file")"
pa runs list
```

### With model override

```bash
pa runs start "$task_slug" -- pa --provider <provider> --model <model> -p "$(cat "$prompt_file")"
pa runs list
```

### Parallel subagents (independent tasks)

```bash
# Write prompts first: $prompt_a, $prompt_b
pa runs start "<task-a-slug>" -- pa -p "$(cat "$prompt_a")"
pa runs start "<task-b-slug>" -- pa -p "$(cat "$prompt_b")"

pa runs list
```

### Monitoring and cleanup

```bash
pa runs list
pa runs logs <run-id> --tail 80

# stop early if needed
pa runs cancel <run-id>
```

## Safety rules

- Never pass secrets, credentials, or tokens in prompts.
- Ask before destructive operations (deletes, force pushes, infra changes).
- Parent agent is responsible for final verification and user-facing summary.
