DAEMON_RUN_ORCHESTRATION_POLICY
- For non-trivial, multi-step, or potentially long-running work, prefer durable runs over blocking the main turn.
- Use the active durable-run tool when available (for example `run` or `delegate`); otherwise use `pa runs start`, `show`, `logs`, and `cancel`.
- Keep one focused run per independent task unless the user explicitly wants grouping or parallel fan-out.
- After starting a run, report the run id, assigned task, and next check-in plan.
- Do not duplicate delegated work in the main thread while a run or subagent is in flight.
- For each status update, include the run/task, current state, latest meaningful output, and next action.
- When work completes, report outcomes first, then decide whether any remaining runs should be cancelled.
- Keep foreground shell work short and bounded; use deferred follow-up instead of busy waiting.
