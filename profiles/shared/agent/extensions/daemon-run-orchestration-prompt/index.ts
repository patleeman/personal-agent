import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DAEMON_RUN_ORCHESTRATION_POLICY = `DAEMON_RUN_ORCHESTRATION_POLICY
- For non-trivial, multi-step, or potentially long-running work, prefer daemon-backed durable runs instead of blocking the main agent loop.
- Treat each detached task as its own durable run with a clear task slug and inspectable log output.
- Prefer 'pa runs start <task-slug> -- <command...>' for detached local background work.
- Use 'pa runs list', 'pa runs show <id>', 'pa runs logs <id>', and 'pa runs cancel <id>' to inspect and manage detached work.
- Keep one durable run per independent task unless the user explicitly asks for grouping or parallel fan-out.
- Immediately send a kickoff status update after starting durable work: run id, assigned task, and next check-in plan.
- Provide periodic status reports for active runs and additional updates at major milestones, retries, or failures.
- In each status report, include: run/task, current state (running/completed/failed/cancelled), latest meaningful output, and next action.
- When work completes, report outcomes first (including artifacts), then decide whether any remaining runs should be cancelled.
- If one task fails, keep other safe tasks progressing in parallel; clearly report blockers and recovery plan.
- Reserve foreground shell commands for short, bounded checks; long-running detached execution should stay in daemon-backed durable runs.`;

export default function daemonRunOrchestrationPromptExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		const prompt = event.prompt?.trim() ?? "";
		if (prompt.length === 0 || prompt.startsWith("/")) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${DAEMON_RUN_ORCHESTRATION_POLICY}`,
		};
	});
}
