# Tmux surface migration plan

Date: 2026-03-12
Project: `durable-background-runs-without-tmux`

## Goal

Remove tmux as a first-class **local** orchestration feature once durable daemon-backed replacements exist.

The migration should be staged so users do not lose inspectability while the new runs/conversation surfaces come online.

## Scope boundary

This migration targets **local product orchestration**, not every tmux mention in the repo.

### In scope

- local CLI tmux commands
- local gateway `/tmux` orchestration
- scheduled-task tmux execution settings
- agent policy/extensions that steer local long-running work into tmux
- local docs that recommend tmux as the main background-work mechanism

### Out of scope

- remote-host operational docs that happen to use tmux on external machines
- incidental historical references that are not active product surfaces

## Replacement model

Before removing tmux surfaces, the repo needs two replacements:

1. **durable runs** for background jobs and scheduled-task execution
2. **restart-recoverable conversations** for live agent work

The product rule after migration should be:

- detached background work → durable runs
- durable live agent work → daemon-backed conversation runtime
- tmux is no longer the default or advertised local orchestration primitive

## Phase 1: introduce replacement surfaces

### CLI

Add a new surface such as:

- `pa runs list`
- `pa runs show <id>`
- `pa runs logs <id>`
- `pa runs cancel <id>`

Only after this exists should `pa tmux` be deprecated/removed.

### Gateway

Add a new daemon-backed background command such as:

- `/run ...`
- or `/jobs ...`

This should eventually replace:

- `/tmux list`
- `/tmux inspect`
- `/tmux logs`
- `/tmux stop`
- `/tmux run`
- `/tmux clean`

### Web

The web should use daemon-backed runs or durable conversations instead of in-process background ownership.

Important current path to replace:

- `packages/web/server/index.ts` → `POST /api/tasks/:id/run`

## Phase 2: remove tmux from scheduled tasks

### Code paths to replace

- `packages/daemon/src/config.ts`
- `packages/daemon/src/modules/tasks-parser.ts`
- `packages/daemon/src/modules/tasks-runner.ts`
- `packages/daemon/src/modules/tasks.ts`

### Features to remove

- task frontmatter field `runInTmux`
- daemon config `modules.tasks.runTasksInTmux`
- tmux execution branch in the task runner

### Docs/examples to update

- `docs/configuration.md`
- `docs/scheduled-tasks.md`
- `docs/examples/scheduled-task.task.md`
- `docs/daemon.md`

## Phase 3: remove tmux CLI surface

### Delete / replace

- `packages/cli/src/tmux-command.ts`
- `packages/cli/src/tmux.ts`
- command registration and help references in `packages/cli/src/index.ts`
- related CLI tests:
  - `packages/cli/src/tmux-commands.test.ts`
  - `packages/cli/src/tmux.test.ts`
  - tmux references in `packages/cli/src/index.test.ts`
  - tmux references in `packages/cli/src/help-discoverability.test.ts`
  - tmux references in `packages/cli/src/args.test.ts`
  - tmux references in `packages/cli/src/args.ts`

### Docs to update

- `docs/command-line.md`

## Phase 4: remove gateway tmux orchestration

### Replace

- `packages/gateway/src/telegram-tmux.ts`
- tmux orchestration/watch logic in `packages/gateway/src/index.ts`
- tmux command references in:
  - `packages/gateway/src/extensions/gateway-context.ts`
  - `packages/gateway/src/index.test.ts`
  - `docs/gateway.md`

### Replacement requirements

The new gateway background-run surface must preserve:

- inspectability of active runs
- access to logs/results
- completion/failure surfacing
- optional follow-up/resume behavior

## Phase 5: remove agent policy and skill steering toward tmux

### Remove / replace

- `profiles/shared/agent/extensions/tmux-orchestration-prompt/index.ts`
- `profiles/shared/agent/extensions/README.md`
- `profiles/shared/agent/skills/subagent/SKILL.md`
- `profiles/shared/agent/skills/subagent-code-review/SKILL.md`
- docs that present tmux as a first-class capability:
  - `docs/skills-and-capabilities.md`

### Replacement guidance

Policy/skill guidance should point to:

- durable runs for detached background work
- durable conversations for restart-safe live work

## Phase 6: cleanup and migration verification

### Verify replacement parity

Need to verify that the new surfaces cover:

- start work
- inspect work
- read logs
- cancel/stop work
- recover after restart
- surface results later

### Remove stale runtime artifacts

Old local tmux state may remain under the personal-agent state root.

Likely cleanup targets:

- legacy tmux log directories under local state
- stale managed sessions if still present
- user-facing docs/help text that reference tmux as current behavior

### Optional transitional affordances

If needed for one release window:

- keep `pa tmux` as a thin wrapper that prints deprecation guidance
- map `/tmux` gateway usage to a migration hint
- add doctor or startup warnings when old tmux-managed local state is detected

Because this repo does not prioritize backward compatibility, these transitional shims can be short-lived.

## Recommended removal order

1. durable runs substrate exists
2. runs IPC/CLI exists
3. scheduled tasks stop using tmux
4. web background execution moves onto daemon-backed durable ownership
5. gateway replacement command exists
6. tmux policy/skills/docs are updated
7. tmux codepaths are deleted

## Success criteria

The migration is successful when:

- local background orchestration no longer depends on tmux
- tmux is no longer advertised as the normal local path in CLI, gateway, docs, or agent policy
- scheduled tasks and durable conversations both use restart-recoverable daemon-backed mechanisms
- users can still inspect logs, status, and results without tmux session management
