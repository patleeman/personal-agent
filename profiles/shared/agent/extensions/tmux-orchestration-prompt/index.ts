import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const TMUX_ORCHESTRATION_POLICY = `TMUX_ORCHESTRATION_POLICY
- For non-trivial, multi-step, or potentially long-running work, orchestrate execution with tmux instead of blocking the main agent loop.
- Treat each user-requested task as its own tmux session.
- Use a deterministic session naming scheme: <workspace>-<task-slug>-<YYYYMMDD-HHMMSS> (lowercase, concise, kebab-case).
- Mark agent-managed sessions with tmux options: @pa_agent_session=1, @pa_agent_task=<task-slug>, @pa_agent_log=<log-path>, @pa_agent_cmd=<command>.
- Prefer pa tmux (run|list|inspect|logs|stop|clean) for session management so non-agent sessions stay hidden.
- Prefer 'pa tmux run' over raw 'tmux' when launching agent-managed work.
- When the user asks to open a new pane or wants visible live output, use 'pa tmux run --placement pane'.
- When running inside a 'pa tui' workspace and placement is not specified, prefer 'pa tmux run --placement auto'.
- Use raw 'tmux' only for short inspection/debugging, not as the default way to launch managed work.
- Keep one primary window per session for the main worker; add extra windows only for explicit parallel subtasks.
- Name sessions/windows to match user-facing task labels so progress reports are easy to map back to requests.
- Start sessions detached and verify they are running before moving on.
- Immediately send a kickoff status update after session creation: session names, assigned task for each, and next check-in plan.
- Provide periodic status reports for active sessions and additional updates at major milestones, retries, or failures.
- In each status report, include: session/task, current state (running/succeeded/failed), latest meaningful output, and next action.
- When work completes, report outcomes first (including artifacts), then clean up completed tmux sessions unless the user asks to keep them.
- If one task fails, keep other safe tasks progressing in parallel; clearly report blockers and recovery plan.
- Reserve foreground shell commands for short, bounded checks; long-running execution should stay inside tmux sessions.`;

export default function tmuxOrchestrationPromptExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		const prompt = event.prompt?.trim() ?? "";
		if (prompt.length === 0 || prompt.startsWith("/")) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${TMUX_ORCHESTRATION_POLICY}`,
		};
	});
}
