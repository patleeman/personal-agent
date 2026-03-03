---
name: tool-task-factory
description: Use Task Factory to decompose ambiguous projects into sequenced tasks, run planning/execution queues, and configure/validate pre-planning, pre-execution, and post-execution hooks.
---

# Task Factory Operator Playbook

Use this skill when a user asks to create/manage Task Factory workspaces or tasks, run queued execution, or set up hook skills.

## Core operating principle

Task Factory is for **queue-first autonomous execution**:
- You provide high-level goals and constraints.
- Task agents do their own investigation and planning.
- You sequence work by ordering tasks and controlling ready/executing flow.
- You verify outcomes later.

For large or ambiguous projects, default to Task Factory orchestration instead of handling everything inline.

## Outcomes

1. Task is created with clear criteria and can move through phases.
2. Hooks are configured (task-level or global defaults).
3. Hook execution is verified via task activity logs.
4. Common failures are diagnosed and fixed quickly.

---

## Default strategy for large, ambiguous requests

Use Task Factory as an orchestrator when scope is broad or under-specified:

1. Break work into a dependency-ordered set of tasks.
2. Add all tasks to Task Factory backlog quickly (high-level instructions are fine).
3. Let planning run for each task.
4. Stage tasks to `ready` in execution order.
5. Let queue/execution run.
6. Verify later (block and poll, or schedule a one-time check-in via `pa` daemon task).

Prefer this over trying to execute a big ambiguous project in one direct session.

---

## 0) Preflight (always)

Run these first:

```bash
task-factory --version
task-factory daemon status
task-factory --help
task-factory task --help
task-factory task update --help
```

If daemon is down:

```bash
task-factory daemon start
```

Then identify workspace:

```bash
task-factory workspace list
```

Use the **full workspace ID** from `workspace list` whenever possible.

---

## 1) Workspace bootstrap workflow

Create or reuse a workspace, then verify queue state.

Path selection rules:
- A Task Factory workspace should map to a **code repository path**.
- If user gave a repo/path, use that exact path.
- Otherwise, use the current repo root.

```bash
# Create from the target repo path
mkdir -p <repo-path>
task-factory workspace create <repo-path>

# Inspect
task-factory workspace show <workspace-id>
task-factory queue status --workspace <workspace-id>
```

Queue control:

```bash
task-factory queue start --workspace <workspace-id>
task-factory queue stop --workspace <workspace-id>
```

---

## 2) Create an executable task workflow

Create task:

```bash
task-factory task create \
  --workspace <workspace-id> \
  --title "<title>" \
  --content "<what to do>"
```

Add acceptance criteria (**required to move to ready**):

```bash
task-factory task update <task-id> \
  --acceptance-criteria "criterion 1,criterion 2"
```

Optional: assign task-level hooks:

```bash
task-factory task update <task-id> \
  --pre-planning-skills "<skill-a>,<skill-b>" \
  --pre-execution-skills "<skill-c>" \
  --post-execution-skills "<skill-d>"
```

Promote and execute:

```bash
task-factory task move <task-id> --to ready --reason "ready to run"
task-factory task execute <task-id>
```

Monitor:

```bash
task-factory task show <task-id>
task-factory task activity <task-id> --limit 200
task-factory task conversation <task-id>
```

---

## 2b) Large-project decomposition + sequencing workflow (preferred)

Use this when the user asks for a large project with many moving parts.

Task authoring guideline (keep task prompts high-level but testable):
- State desired outcome and acceptance criteria.
- Include constraints (tech stack, repo area, non-goals, deadlines).
- Avoid prescribing implementation details unless required.

1. Define a dependency-ordered task list (T1, T2, T3...).
2. Create all tasks with high-level instructions.
3. Add acceptance criteria and backlog order.
4. Let planning run for each task.
5. Move tasks to `ready` in dependency order.
6. For strict sequencing, keep execution concurrency at 1.
7. Check back later to verify outcomes.

Command skeleton:

```bash
# Create a batch of tasks
task-factory task create --workspace <workspace-id> --title "T1" --content "<high-level objective>"
task-factory task create --workspace <workspace-id> --title "T2" --content "<high-level objective>"

# Set criteria + ordering
task-factory task update TASK-1 --acceptance-criteria "criterion a,criterion b" --order 10
task-factory task update TASK-2 --acceptance-criteria "criterion a,criterion b" --order 20

# Keep strict sequencing (single active execution)
task-factory settings set workflowDefaults.executingLimit 1

# Stage in execution order
task-factory task move TASK-1 --to ready --reason "dependency order"
task-factory task move TASK-2 --to ready --reason "dependency order"
```

Verification options:

- **Block and poll now**

```bash
task-factory task list --workspace <workspace-id> --phase active
task-factory task activity <task-id> --limit 200
```

- **Schedule one-time check-in later** (recommended for long runs)
  - Create `~/.config/personal-agent/tasks/task-factory-checkin.task.md` with an `at:` schedule.
  - In prompt body, ask the agent to inspect the target workspace tasks and summarize status/failures.
  - Validate and monitor:

```bash
pa tasks validate --all
pa tasks list
pa tasks show task-factory-checkin
```

For scheduling specifics, follow `pa-scheduled-tasks` skill.

---

## 3) Hook configuration workflow (global defaults)

Prefer settings file values over ad-hoc env vars.

```bash
task-factory settings set taskDefaults.prePlanningSkills '["<pre-planning-skill>"]'
task-factory settings set taskDefaults.preExecutionSkills '["<pre-execution-skill>"]'
task-factory settings set taskDefaults.postExecutionSkills '["<post-execution-skill>"]'
task-factory settings get
```

These defaults apply to newly created tasks.

---

## 4) Hook skill authoring workflow

Create hook skill under:

`~/.taskfactory/skills/<skill-id>/SKILL.md`

Minimal template:

````markdown
---
name: <skill-id>
description: <what this hook does>
metadata:
  author: <name>
  version: "1.0"
  type: follow-up
  hooks: <pre-planning|pre|post>
---

# <Title>

```bash
echo "hook ran"
```
````

Reload and verify:

```bash
task-factory skills reload
task-factory skills list
task-factory skills get <skill-id>
```

### Important hook-name compatibility note (v0.5.x)

In current builds, hook metadata accepts:
- `pre-planning`
- `pre`
- `post`

Task flags still use:
- `--pre-execution-skills`
- `--post-execution-skills`

So: **metadata uses `pre`/`post`**, while task update flags use `pre-execution`/`post-execution` wording.

---

## 5) End-to-end hook smoke test

1. Create 3 tiny hook skills (pre-planning, pre, post) that each print a unique message.
2. `task-factory skills reload`
3. Create a test task.
4. Set acceptance criteria.
5. Attach all three hooks via `task update`.
6. Move to `ready` and execute.
7. Check `task activity` for events like:
   - `Running N pre-planning skill(s)`
   - `Running N pre-execution skill(s)`
   - `Running N post-execution skill(s)`

If post hooks don’t run, the execution may still be active/awaiting input; verify with `task show` and `task activity`.

---

## 6) Fast troubleshooting

- **"Server Not Running"**
  - Run `task-factory daemon start`.

- **"Task must have acceptance criteria before moving to Ready"**
  - Add criteria via `task update --acceptance-criteria ...`.

- **"Task planning is still running" when executing**
  - Stop current run: `task-factory task stop <task-id>`
  - Re-run execute.

- **Unknown hook skill IDs**
  - Verify with `task-factory skills list` and exact ID spelling.

- **Hook metadata rejected**
  - Use `hooks: pre-planning|pre|post` in skill frontmatter.

- **Need deferred verification for long-running queue**
  - Either poll with `task list/task activity`, or schedule a one-time `pa` daemon check-in task (`at:` schedule).

- **CLI command from docs fails**
  - Re-check live capabilities with `task-factory --help` and subcommand `--help`.
  - Do not assume older/newer docs match installed version.

---

## Agent behavior when using this skill

When completing a user request:
1. Do preflight and confirm capabilities from live CLI help.
2. For large ambiguous requests, use queue-first orchestration: decompose into sequenced tasks and enqueue them instead of doing everything inline.
3. Keep task prompts high-level + constraint-aware so agents can investigate/plan autonomously.
4. Stage tasks in dependency order and let planning/execution run.
5. Verify now (`task show`/`task activity`) or schedule a one-time `pa` check-in task for later.
6. Report concrete IDs, paths, ordering decisions, and observed hook events.
