import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATE_DIR = "/tmp/pi";
const STATUS_KEY = "background-bash";
const STATUS_REFRESH_MS = 3000;
const OWNER_PID = process.pid;
const JOB_ENTRY_TYPE = "background-bash-job";

interface BackgroundJobRecord {
	jobId: string;
	pid: number;
	cwd: string;
	logPath: string;
	command: string;
	startedAt: string;
}

interface BackgroundState {
	ownerPid: number;
	startedAt: string;
	jobs: BackgroundJobRecord[];
}

function makeJobId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `${Date.now()}-${rand}`;
}

function getStatePath(pid = OWNER_PID): string {
	return join(STATE_DIR, `${pid}.json`);
}

function getLogPath(jobId: string): string {
	return join(STATE_DIR, `${OWNER_PID}-${jobId}.log`);
}

function createFreshState(): BackgroundState {
	return {
		ownerPid: OWNER_PID,
		startedAt: new Date().toISOString(),
		jobs: [],
	};
}

function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		if (error?.code === "EPERM") {
			return true;
		}
		return false;
	}
}

function parseJobRecord(job: Partial<BackgroundJobRecord> | undefined | null): BackgroundJobRecord | null {
	if (!job || typeof job.pid !== "number" || typeof job.jobId !== "string") {
		return null;
	}

	return {
		jobId: job.jobId,
		pid: job.pid,
		cwd: job.cwd ?? "",
		logPath: job.logPath ?? "",
		command: job.command ?? "",
		startedAt: job.startedAt ?? "",
	};
}

function parseState(content: string): BackgroundState | null {
	try {
		const parsed = JSON.parse(content) as Partial<BackgroundState>;
		if (!parsed || typeof parsed.ownerPid !== "number" || !Array.isArray(parsed.jobs)) {
			return null;
		}

		const jobs: BackgroundJobRecord[] = [];
		for (const rawJob of parsed.jobs as Partial<BackgroundJobRecord>[]) {
			const job = parseJobRecord(rawJob);
			if (!job) {
				continue;
			}
			jobs.push(job);
		}

		return {
			ownerPid: parsed.ownerPid,
			startedAt: parsed.startedAt ?? "",
			jobs,
		};
	} catch {
		return null;
	}
}

function loadJobsFromSession(ctx: ExtensionContext): BackgroundJobRecord[] {
	const jobs: BackgroundJobRecord[] = [];
	const seenJobIds = new Set<string>();

	for (const entry of ctx.sessionManager.getEntries()) {
		const customEntry = entry as any;
		if (customEntry?.type !== "custom" || customEntry.customType !== JOB_ENTRY_TYPE) {
			continue;
		}

		const job = parseJobRecord(customEntry.data as Partial<BackgroundJobRecord>);
		if (!job || seenJobIds.has(job.jobId)) {
			continue;
		}

		seenJobIds.add(job.jobId);
		jobs.push(job);
	}

	return jobs;
}

async function ensureStateDir(): Promise<void> {
	await mkdir(STATE_DIR, { recursive: true });
}

async function writeState(state: BackgroundState): Promise<void> {
	await writeFile(getStatePath(), JSON.stringify(state, null, 2));
}

async function readStateFile(path: string): Promise<BackgroundState | null> {
	try {
		const content = await readFile(path, "utf-8");
		return parseState(content);
	} catch {
		return null;
	}
}

async function cleanupStateFile(path: string): Promise<void> {
	await rm(path, { force: true });
}

async function cleanupStaleOwnerStateFiles(): Promise<void> {
	const entries = await readdir(STATE_DIR, { withFileTypes: true }).catch(() => null);
	if (!entries) {
		return;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".json")) {
			continue;
		}

		const name = entry.name.slice(0, -5);
		const ownerPid = Number(name);
		if (!Number.isInteger(ownerPid) || ownerPid <= 0 || ownerPid === OWNER_PID) {
			continue;
		}

		if (isProcessRunning(ownerPid)) {
			continue;
		}

		await cleanupStateFile(join(STATE_DIR, entry.name));
	}
}

function getJobCounts(state: BackgroundState): { active: number; total: number } {
	let active = 0;
	for (const job of state.jobs) {
		if (isProcessRunning(job.pid)) {
			active += 1;
		}
	}
	return { active, total: state.jobs.length };
}

async function refreshStatus(ctx: ExtensionContext, state: BackgroundState): Promise<void> {
	if (!ctx.hasUI) {
		return;
	}

	try {
		const { active, total } = getJobCounts(state);
		const theme = ctx.ui.theme;
		const icon = active > 0 ? theme.fg("warning", "●") : theme.fg("dim", "○");
		const text = theme.fg("dim", ` bg:${active}/${total}`);
		ctx.ui.setStatus(STATUS_KEY, icon + text);
	} catch {
		ctx.ui.setStatus(STATUS_KEY, "bg:?/?");
	}
}

function spawnBackgroundCommand(command: string, cwd: string, logPath: string): number {
	const shell = process.env.SHELL ?? "/bin/bash";
	const fd = openSync(logPath, "a");

	try {
		const child = spawn(shell, ["-lc", command], {
			cwd,
			env: process.env,
			detached: true,
			stdio: ["ignore", fd, fd],
		});

		if (!child.pid) {
			throw new Error("Failed to start background process: child pid is undefined");
		}

		child.unref();
		return child.pid;
	} finally {
		closeSync(fd);
	}
}

function truncate(text: string, max = 80): string {
	if (text.length <= max) {
		return text;
	}
	return `${text.slice(0, max - 1)}…`;
}

function formatAge(startedAt: string): string {
	const startedMs = Date.parse(startedAt);
	if (!Number.isFinite(startedMs)) {
		return "?";
	}

	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;

	if (hours > 0) return `${hours}h${minutes}m`;
	if (minutes > 0) return `${minutes}m${seconds}s`;
	return `${seconds}s`;
}

function findJob(state: BackgroundState, id: string): BackgroundJobRecord | undefined {
	const pid = Number(id);
	if (Number.isInteger(pid) && pid > 0) {
		return state.jobs.find((job) => job.pid === pid) ?? state.jobs.find((job) => job.jobId === id);
	}
	return state.jobs.find((job) => job.jobId === id);
}

async function readLastLogLines(logPath: string, lineCount: number): Promise<string[]> {
	const content = await readFile(logPath, "utf-8");
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines.slice(-lineCount);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	background: Type.Optional(Type.Boolean({ description: "If true, run detached in the background and return immediately" })),
});

export default function (pi: ExtensionAPI) {
	const baseBash = createBashTool(process.cwd());
	let statusTimer: ReturnType<typeof setInterval> | null = null;
	let state = createFreshState();
	let stateInitialized = false;

	const initializeState = async (_forceFresh: boolean, ctx: ExtensionContext) => {
		await ensureStateDir();
		await cleanupStaleOwnerStateFiles();

		state = createFreshState();
		state.jobs = loadJobsFromSession(ctx);
		await writeState(state);
		stateInitialized = true;
	};

	pi.on("session_start", async (_event, ctx) => {
		await initializeState(false, ctx);
		await refreshStatus(ctx, state);

		if (statusTimer) {
			clearInterval(statusTimer);
		}
		statusTimer = setInterval(() => {
			void refreshStatus(ctx, state);
		}, STATUS_REFRESH_MS);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!stateInitialized) {
			await initializeState(false, ctx);
		}
		await refreshStatus(ctx, state);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await initializeState(false, ctx);
		await refreshStatus(ctx, state);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (statusTimer) {
			clearInterval(statusTimer);
			statusTimer = null;
		}
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.registerCommand("bg", {
		description: "Interactive background job menu (/bg). Also: /bg list|inspect|logs",
		handler: async (args, ctx) => {
			if (!stateInitialized) {
				await initializeState(false, ctx);
			}

			const tokens = args
				.trim()
				.split(/\s+/)
				.filter((part) => part.length > 0);
			const subcommand = tokens[0]?.toLowerCase();

			const inspectJob = (job: BackgroundJobRecord) => {
				const running = isProcessRunning(job.pid);
				const lines = [
					`jobId: ${job.jobId}`,
					`pid: ${job.pid}`,
					`status: ${running ? "running" : "exited"}`,
					`age: ${formatAge(job.startedAt)}`,
					`startedAt: ${job.startedAt || "?"}`,
					`cwd: ${job.cwd || "?"}`,
					`log: ${job.logPath || "?"}`,
					`command: ${job.command || ""}`,
				];
				ctx.ui.notify(lines.join("\n"), "info");
			};

			const showLogs = async (job: BackgroundJobRecord, lineCount: number) => {
				if (!job.logPath) {
					ctx.ui.notify(`No log path for job ${job.jobId}`, "warning");
					return;
				}

				try {
					const lines = await readLastLogLines(job.logPath, lineCount);
					if (lines.length === 0) {
						ctx.ui.notify(`No log output yet for ${job.jobId}.`, "info");
						return;
					}
					ctx.ui.notify(`Logs for ${job.jobId} (last ${lineCount})\n${lines.join("\n")}`, "info");
				} catch (error: any) {
					ctx.ui.notify(`Failed to read logs: ${error?.message ?? "unknown error"}`, "error");
				}
			};

			if (!subcommand || subcommand === "menu") {
				const { active, total } = getJobCounts(state);
				if (total === 0) {
					ctx.ui.notify("No background jobs.", "info");
					return;
				}

				const jobs = [...state.jobs].reverse();
				const options = jobs.map((job) => {
					const icon = isProcessRunning(job.pid) ? "●" : "○";
					return `${icon} ${job.jobId} pid:${job.pid} age:${formatAge(job.startedAt)} ${truncate(job.command, 60)}`;
				});

				const selected = await ctx.ui.select(`Background jobs (${active}/${total} active)`, options);
				if (!selected) {
					return;
				}

				const selectedIndex = options.indexOf(selected);
				const job = selectedIndex >= 0 ? jobs[selectedIndex] : undefined;
				if (!job) {
					ctx.ui.notify("Selected job is no longer available.", "warning");
					return;
				}

				const action = await ctx.ui.select(`Job ${job.jobId}`, [
					"Inspect details",
					"View logs (last 50 lines)",
					"Cancel",
				]);

				if (!action || action === "Cancel") {
					return;
				}

				if (action === "Inspect details") {
					inspectJob(job);
					return;
				}

				await showLogs(job, 50);
				return;
			}

			if (subcommand === "list") {
				const { active, total } = getJobCounts(state);
				if (total === 0) {
					ctx.ui.notify("No background jobs.", "info");
					return;
				}

				const rows = [...state.jobs].reverse().map((job) => {
					const running = isProcessRunning(job.pid);
					const icon = running ? "●" : "○";
					return `${icon} ${job.jobId} pid:${job.pid} age:${formatAge(job.startedAt)} ${truncate(job.command)}`;
				});

				ctx.ui.notify(`Background jobs (active/total: ${active}/${total})\n${rows.join("\n")}`, "info");
				return;
			}

			if (subcommand === "inspect") {
				const id = tokens[1];
				if (!id) {
					ctx.ui.notify("Usage: /bg inspect <pid|jobId>", "warning");
					return;
				}

				const job = findJob(state, id);
				if (!job) {
					ctx.ui.notify(`Job not found: ${id}`, "warning");
					return;
				}

				inspectJob(job);
				return;
			}

			if (subcommand === "logs") {
				const id = tokens[1];
				if (!id) {
					ctx.ui.notify("Usage: /bg logs <pid|jobId> [lines]", "warning");
					return;
				}

				const job = findJob(state, id);
				if (!job) {
					ctx.ui.notify(`Job not found: ${id}`, "warning");
					return;
				}

				const requestedLines = Number(tokens[2] ?? "50");
				const lineCount = Number.isInteger(requestedLines)
					? Math.max(1, Math.min(500, requestedLines))
					: 50;

				await showLogs(job, lineCount);
				return;
			}

			ctx.ui.notify("Usage: /bg [menu|list|inspect <pid|jobId>|logs <pid|jobId> [lines]]", "warning");
		},
	});

	pi.registerTool({
		...baseBash,
		name: "bash",
		label: "bash",
		description:
			"Execute a bash command. Set background=true to run detached and return immediately with pid and log path.",
		parameters: bashSchema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			if (!params.background) {
				return baseBash.execute(
					toolCallId,
					{ command: params.command, timeout: params.timeout },
					signal,
					onUpdate,
				);
			}

			if (!stateInitialized) {
				await initializeState(false, ctx);
			}

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Background command aborted before start" }],
					details: {},
				};
			}

			const jobId = makeJobId();
			const logPath = getLogPath(jobId);
			const pid = spawnBackgroundCommand(params.command, ctx.cwd, logPath);
			const jobRecord: BackgroundJobRecord = {
				jobId,
				pid,
				cwd: ctx.cwd,
				command: params.command,
				logPath,
				startedAt: new Date().toISOString(),
			};

			state.jobs.push(jobRecord);
			pi.appendEntry(JOB_ENTRY_TYPE, jobRecord);
			await writeState(state);
			await refreshStatus(ctx, state);

			const timeoutNote =
				typeof params.timeout === "number"
					? "\nNote: timeout is ignored for background=true."
					: "";

			return {
				content: [
					{
						type: "text",
						text: `Started background job ${jobId} (pid ${pid}).\nLogs: ${logPath}\nUse bash (e.g. kill ${pid}) to stop it.${timeoutNote}`,
					},
				],
				details: { backgroundJob: jobRecord },
			};
		},
	});
}
