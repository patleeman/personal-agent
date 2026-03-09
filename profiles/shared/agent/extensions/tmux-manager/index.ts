import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const STATUS_KEY = "tmux-sessions";
const STATUS_REFRESH_MS = 3000;

const MANAGED_OPTION = "@pa_agent_session";
const TASK_OPTION = "@pa_agent_task";
const LOG_OPTION = "@pa_agent_log";
const COMMAND_OPTION = "@pa_agent_cmd";

const LIST_FORMAT = [
	"#{session_name}",
	"#{session_id}",
	"#{session_windows}",
	"#{session_attached}",
	"#{session_created}",
	`#{${MANAGED_OPTION}}`,
	`#{${TASK_OPTION}}`,
	`#{${LOG_OPTION}}`,
	`#{${COMMAND_OPTION}}`,
].join("\t");

interface ManagedTmuxSession {
	name: string;
	id: string;
	windows: number;
	attachedClients: number;
	createdEpochSeconds: number | null;
	task: string | null;
	logPath: string | null;
	command: string | null;
}

interface TmuxCommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
	error?: Error;
}

function runTmux(args: string[]): TmuxCommandResult {
	const result = spawnSync("tmux", args, {
		encoding: "utf-8",
	});

	return {
		status: result.status,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		error: result.error,
	};
}

function normalizeOutput(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function isTmuxMissing(result: TmuxCommandResult): boolean {
	if (!result.error) {
		return false;
	}

	const code = (result.error as NodeJS.ErrnoException).code;
	return code === "ENOENT";
}

function isNoServerRunning(result: TmuxCommandResult): boolean {
	const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
	return combined.includes("no server running")
		|| combined.includes("failed to connect to server")
		|| combined.includes("error connecting to");
}

function parseOptionalString(value: string | undefined): string | null {
	const normalized = (value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function parseManagedSessionLine(line: string): ManagedTmuxSession | null {
	if (line.trim().length === 0) {
		return null;
	}

	const parts = line.split("\t");
	const managed = (parts[5] ?? "").trim();
	const name = (parts[0] ?? "").trim();

	if (managed !== "1" || name.length === 0) {
		return null;
	}

	const createdEpoch = Number.parseInt((parts[4] ?? "").trim(), 10);
	const windows = Number.parseInt((parts[2] ?? "0").trim(), 10);
	const attachedClients = Number.parseInt((parts[3] ?? "0").trim(), 10);

	return {
		name,
		id: (parts[1] ?? "").trim(),
		windows: Number.isFinite(windows) ? windows : 0,
		attachedClients: Number.isFinite(attachedClients) ? attachedClients : 0,
		createdEpochSeconds: Number.isFinite(createdEpoch) ? createdEpoch : null,
		task: parseOptionalString(parts[6]),
		logPath: parseOptionalString(parts[7]),
		command: parseOptionalString(parts[8]),
	};
}

function listManagedSessions(): { sessions: ManagedTmuxSession[]; tmuxMissing: boolean } {
	const result = runTmux(["list-sessions", "-F", LIST_FORMAT]);

	if ((result.status ?? 1) !== 0) {
		if (isTmuxMissing(result)) {
			return {
				sessions: [],
				tmuxMissing: true,
			};
		}

		if (isNoServerRunning(result)) {
			return {
				sessions: [],
				tmuxMissing: false,
			};
		}

		throw new Error(normalizeOutput(result.stderr || result.stdout) || "tmux list-sessions failed");
	}

	const sessions = normalizeOutput(result.stdout)
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => parseManagedSessionLine(line))
		.filter((session): session is ManagedTmuxSession => session !== null)
		.sort((left, right) => {
			const leftCreated = left.createdEpochSeconds ?? 0;
			const rightCreated = right.createdEpochSeconds ?? 0;
			if (leftCreated !== rightCreated) {
				return rightCreated - leftCreated;
			}
			return left.name.localeCompare(right.name);
		});

	return {
		sessions,
		tmuxMissing: false,
	};
}

function formatAge(createdEpochSeconds: number | null): string {
	if (!createdEpochSeconds || !Number.isFinite(createdEpochSeconds)) {
		return "unknown";
	}

	const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdEpochSeconds);
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;

	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m${seconds}s`;
	return `${seconds}s`;
}

function readLastLogLines(logPath: string, lineCount: number): string {
	const text = readFileSync(logPath, "utf-8").replace(/\r\n/g, "\n");
	const lines = text.split("\n");
	return lines.slice(-lineCount).join("\n").trimEnd();
}

function capturePane(sessionName: string, lineCount: number): string {
	const safeLineCount = Math.max(1, Math.min(1000, Math.floor(lineCount)));
	const result = runTmux(["capture-pane", "-pt", sessionName, "-S", `-${safeLineCount}`]);

	if ((result.status ?? 1) !== 0) {
		throw new Error(normalizeOutput(result.stderr || result.stdout) || "tmux capture-pane failed");
	}

	return normalizeOutput(result.stdout);
}

function findManagedSession(sessionName: string): ManagedTmuxSession | undefined {
	const { sessions } = listManagedSessions();
	return sessions.find((session) => session.name === sessionName);
}

function resolveStateRoot(): string {
	if (process.env.PERSONAL_AGENT_STATE_ROOT) {
		return process.env.PERSONAL_AGENT_STATE_ROOT;
	}

	if (process.env.XDG_STATE_HOME) {
		return join(process.env.XDG_STATE_HOME, "personal-agent");
	}

	return join(homedir(), ".local", "state", "personal-agent");
}

function resolveTmuxLogDirectory(): string {
	return join(resolveStateRoot(), "tmux", "logs");
}

function listTmuxLogFiles(logDirectory: string): string[] {
	if (!existsSync(logDirectory)) {
		return [];
	}

	return readdirSync(logDirectory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
		.map((entry) => join(logDirectory, entry.name))
		.sort();
}

function cleanStaleTmuxLogs(sessions: ManagedTmuxSession[], dryRun: boolean): {
	logDirectory: string;
	staleLogFiles: string[];
	removed: string[];
	errors: Array<{ path: string; error: string }>;
} {
	const logDirectory = resolveTmuxLogDirectory();
	const activeLogPaths = new Set(
		sessions
			.map((session) => session.logPath)
			.filter((value): value is string => typeof value === "string" && value.length > 0)
			.map((value) => resolve(value)),
	);
	const allLogFiles = listTmuxLogFiles(logDirectory);
	const staleLogFiles = allLogFiles.filter((logPath) => !activeLogPaths.has(resolve(logPath)));
	const removed: string[] = [];
	const errors: Array<{ path: string; error: string }> = [];

	if (!dryRun) {
		for (const logPath of staleLogFiles) {
			try {
				rmSync(logPath, { force: true });
				removed.push(logPath);
			} catch (error: any) {
				errors.push({
					path: logPath,
					error: error?.message ?? "unknown error",
				});
			}
		}
	}

	return {
		logDirectory,
		staleLogFiles,
		removed,
		errors,
	};
}

async function refreshStatus(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) {
		return;
	}

	try {
		const { sessions, tmuxMissing } = listManagedSessions();
		const theme = ctx.ui.theme;

		if (tmuxMissing) {
			ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", " tmux:missing"));
			return;
		}

		if (sessions.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const icon = theme.fg("warning", "●");
		const label = theme.fg("dim", ` tmux:${sessions.length}`);
		ctx.ui.setStatus(STATUS_KEY, `${icon}${label}`);
	} catch {
		ctx.ui.setStatus(STATUS_KEY, "tmux:?");
	}
}

export default function tmuxManagerExtension(pi: ExtensionAPI): void {
	let statusTimer: ReturnType<typeof setInterval> | null = null;

	const startStatusTimer = async (ctx: ExtensionContext) => {
		await refreshStatus(ctx);

		if (statusTimer) {
			clearInterval(statusTimer);
		}

		statusTimer = setInterval(() => {
			void refreshStatus(ctx);
		}, STATUS_REFRESH_MS);
	};

	pi.on("session_start", async (_event, ctx) => {
		await startStatusTimer(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await startStatusTimer(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		await startStatusTimer(ctx);
	});

	pi.on("turn_end", async (_event, ctx) => {
		await refreshStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (statusTimer) {
			clearInterval(statusTimer);
			statusTimer = null;
		}

		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.registerCommand("tmux", {
		description: "Manage agent-owned tmux sessions (/tmux list|inspect|logs|stop|send|clean)",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter((part) => part.length > 0);
			const subcommand = tokens[0]?.toLowerCase();

			const requireSession = (sessionName: string): ManagedTmuxSession | undefined => {
				const session = findManagedSession(sessionName);
				if (!session) {
					ctx.ui.notify(`No managed tmux session found: ${sessionName}`, "warning");
					return undefined;
				}
				return session;
			};

			const showSessionDetails = (session: ManagedTmuxSession) => {
				const lines = [
					`session: ${session.name}`,
					`task: ${session.task ?? "?"}`,
					`windows: ${session.windows}`,
					`attached: ${session.attachedClients}`,
					`age: ${formatAge(session.createdEpochSeconds)}`,
					`log: ${session.logPath ?? "(none)"}`,
					`command: ${session.command ?? "(unknown)"}`,
				];
				ctx.ui.notify(lines.join("\n"), "info");
			};

			const showLogs = (session: ManagedTmuxSession, lineCount: number) => {
				try {
					let output = "";
					let source = "tmux pane";
					if (session.logPath && existsSync(session.logPath)) {
						source = session.logPath;
						output = readLastLogLines(session.logPath, lineCount);
					} else {
						output = capturePane(session.name, lineCount);
					}

					if (output.trim().length === 0) {
						ctx.ui.notify(`No output yet for ${session.name}.`, "info");
						return;
					}

					ctx.ui.notify(`Logs for ${session.name} (${source}, last ${lineCount})\n${output}`, "info");
				} catch (error: any) {
					ctx.ui.notify(`Failed to read logs: ${error?.message ?? "unknown error"}`, "error");
				}
			};

			if (!subcommand || subcommand === "menu") {
				const { sessions, tmuxMissing } = listManagedSessions();

				if (tmuxMissing) {
					ctx.ui.notify("tmux is not installed or not available on PATH.", "warning");
					return;
				}

				if (sessions.length === 0) {
					ctx.ui.notify("No managed tmux sessions are running.", "info");
					return;
				}

				const options = sessions.map((session) => `● ${session.name} age:${formatAge(session.createdEpochSeconds)} task:${session.task ?? "?"}`);
				const selected = await ctx.ui.select(`Managed tmux sessions (${sessions.length})`, options);
				if (!selected) {
					return;
				}

				const selectedIndex = options.indexOf(selected);
				const session = selectedIndex >= 0 ? sessions[selectedIndex] : undefined;
				if (!session) {
					ctx.ui.notify("Selected session is no longer available.", "warning");
					return;
				}

				const action = await ctx.ui.select(`Session ${session.name}`, [
					"Inspect details",
					"View logs (last 80 lines)",
					"Stop session",
					"Cancel",
				]);

				if (!action || action === "Cancel") {
					return;
				}

				if (action === "Inspect details") {
					showSessionDetails(session);
					return;
				}

				if (action === "View logs (last 80 lines)") {
					showLogs(session, 80);
					return;
				}

				const killResult = runTmux(["kill-session", "-t", session.name]);
				if ((killResult.status ?? 1) !== 0) {
					ctx.ui.notify(`Failed to stop session: ${normalizeOutput(killResult.stderr || killResult.stdout)}`, "error");
					return;
				}

				ctx.ui.notify(`Stopped session ${session.name}`, "info");
				await refreshStatus(ctx);
				return;
			}

			if (subcommand === "list") {
				const { sessions, tmuxMissing } = listManagedSessions();
				if (tmuxMissing) {
					ctx.ui.notify("tmux is not installed or not available on PATH.", "warning");
					return;
				}

				if (sessions.length === 0) {
					ctx.ui.notify("No managed tmux sessions are running.", "info");
					return;
				}

				const lines = sessions.map((session) => `● ${session.name} age:${formatAge(session.createdEpochSeconds)} task:${session.task ?? "?"}`);
				ctx.ui.notify(`Managed tmux sessions (${sessions.length})\n${lines.join("\n")}`, "info");
				return;
			}

			if (subcommand === "inspect") {
				const sessionName = tokens[1];
				if (!sessionName) {
					ctx.ui.notify("Usage: /tmux inspect <session>", "warning");
					return;
				}

				const session = requireSession(sessionName);
				if (!session) {
					return;
				}

				showSessionDetails(session);
				return;
			}

			if (subcommand === "logs") {
				const sessionName = tokens[1];
				if (!sessionName) {
					ctx.ui.notify("Usage: /tmux logs <session> [lines]", "warning");
					return;
				}

				const session = requireSession(sessionName);
				if (!session) {
					return;
				}

				const requested = Number.parseInt(tokens[2] ?? "80", 10);
				const lineCount = Number.isFinite(requested) ? Math.max(1, Math.min(1000, requested)) : 80;
				showLogs(session, lineCount);
				return;
			}

			if (subcommand === "stop") {
				const sessionName = tokens[1];
				if (!sessionName) {
					ctx.ui.notify("Usage: /tmux stop <session>", "warning");
					return;
				}

				const session = requireSession(sessionName);
				if (!session) {
					return;
				}

				const result = runTmux(["kill-session", "-t", session.name]);
				if ((result.status ?? 1) !== 0) {
					ctx.ui.notify(`Failed to stop session: ${normalizeOutput(result.stderr || result.stdout)}`, "error");
					return;
				}

				ctx.ui.notify(`Stopped session ${session.name}`, "info");
				await refreshStatus(ctx);
				return;
			}

			if (subcommand === "send") {
				const sessionName = tokens[1];
				const command = tokens.slice(2).join(" ").trim();
				if (!sessionName || command.length === 0) {
					ctx.ui.notify("Usage: /tmux send <session> <command>", "warning");
					return;
				}

				const session = requireSession(sessionName);
				if (!session) {
					return;
				}

				const result = runTmux(["send-keys", "-t", session.name, command, "C-m"]);
				if ((result.status ?? 1) !== 0) {
					ctx.ui.notify(`Failed to send command: ${normalizeOutput(result.stderr || result.stdout)}`, "error");
					return;
				}

				ctx.ui.notify(`Sent command to ${session.name}`, "info");
				return;
			}

			if (subcommand === "clean") {
				const flags = tokens.slice(1);
				const dryRun = flags.includes("--dry-run");
				const unknownFlags = flags.filter((flag) => flag !== "--dry-run");
				if (unknownFlags.length > 0) {
					ctx.ui.notify("Usage: /tmux clean [--dry-run]", "warning");
					return;
				}

				const { sessions, tmuxMissing } = listManagedSessions();
				if (tmuxMissing) {
					ctx.ui.notify("tmux is not installed or not available on PATH.", "warning");
					return;
				}

				const cleanup = cleanStaleTmuxLogs(sessions, dryRun);
				if (cleanup.errors.length > 0) {
					ctx.ui.notify(`Cleanup failed for ${cleanup.errors.length} log(s). First error: ${cleanup.errors[0]?.error ?? "unknown error"}`, "error");
					return;
				}

				if (cleanup.staleLogFiles.length === 0) {
					ctx.ui.notify("No stale tmux logs found.", "info");
					return;
				}

				if (dryRun) {
					ctx.ui.notify(`Dry run: ${cleanup.staleLogFiles.length} stale tmux log(s) would be removed.`, "info");
					return;
				}

				ctx.ui.notify(`Removed ${cleanup.removed.length} stale tmux log(s).`, "info");
				return;
			}

			ctx.ui.notify("Usage: /tmux [list|inspect <session>|logs <session> [lines]|stop <session>|send <session> <command>|clean [--dry-run]]", "warning");
		},
	});
}
