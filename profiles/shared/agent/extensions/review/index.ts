/**
 * Code Review Extension (inspired by Codex's review feature)
 *
 * Provides a `/review` command that runs code review as a subagent with model selection.
 * Supports multiple review modes:
 * - Review a GitHub pull request (checks out the PR locally)
 * - Review against a base branch (PR style)
 * - Review uncommitted changes
 * - Review a specific commit
 * - Custom review instructions
 *
 * Usage:
 * - `/review` - show interactive selector
 * - `/review pr 123` - review PR #123 (checks out locally)
 * - `/review pr https://github.com/owner/repo/pull/123` - review PR from URL
 * - `/review uncommitted` - review uncommitted changes directly
 * - `/review branch main` - review against main branch
 * - `/review commit abc123` - review specific commit
 * - `/review custom "check for security issues"` - custom instructions
 *
 * Project-specific review guidelines:
 * - If a REVIEW_GUIDELINES.md file exists in the same directory as .pi,
 *   its contents are appended to the review prompt.
 *
 * Note: PR review requires a clean working tree (no uncommitted changes to tracked files).
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, BorderedLoader, getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text, Markdown, matchesKey } from "@mariozechner/pi-tui";
import type { Message } from "@mariozechner/pi-ai";
import { spawn } from "node:child_process";
import path from "node:path";
import { promises as fs } from "node:fs";

// Review target types (matching Codex's approach)
type ReviewTarget =
	| { type: "uncommitted" }
	| { type: "baseBranch"; branch: string }
	| { type: "commit"; sha: string; title?: string }
	| { type: "custom"; instructions: string }
	| { type: "pullRequest"; prNumber: number; baseBranch: string; title: string };

// Prompts (adapted from Codex)
const UNCOMMITTED_PROMPT =
	"Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.";

const BASE_BRANCH_PROMPT_WITH_MERGE_BASE =
	"Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide prioritized, actionable findings.";

const BASE_BRANCH_PROMPT_FALLBACK =
	"Review the code changes against the base branch '{branch}'. Start by finding the merge diff between the current branch and {branch}'s upstream e.g. (`git merge-base HEAD \"$(git rev-parse --abbrev-ref \"{branch}@{upstream}\")\"`), then run `git diff` against that SHA to see what changes we would merge into the {branch} branch. Provide prioritized, actionable findings.";

const COMMIT_PROMPT_WITH_TITLE =
	'Review the code changes introduced by commit {sha} ("{title}"). Provide prioritized, actionable findings.';

const COMMIT_PROMPT = "Review the code changes introduced by commit {sha}. Provide prioritized, actionable findings.";

const PULL_REQUEST_PROMPT =
	'Review pull request #{prNumber} ("{title}") against the base branch \'{baseBranch}\'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes that would be merged. Provide prioritized, actionable findings.';

const PULL_REQUEST_PROMPT_FALLBACK =
	'Review pull request #{prNumber} ("{title}") against the base branch \'{baseBranch}\'. Start by finding the merge base between the current branch and {baseBranch} (e.g., `git merge-base HEAD {baseBranch}`), then run `git diff` against that SHA to see the changes that would be merged. Provide prioritized, actionable findings.';

// The detailed review rubric (adapted from Codex's review_prompt.md)
const REVIEW_RUBRIC = `# Review Guidelines

You are acting as a code reviewer for a proposed code change.

## Determining what to flag

Flag issues that:
1. Meaningfully impact the accuracy, performance, security, or maintainability of the code.
2. Are discrete and actionable (not general issues or multiple combined issues).
3. Don't demand rigor inconsistent with the rest of the codebase.
4. Were introduced in the changes being reviewed (not pre-existing bugs).
5. The author would likely fix if aware of them.
6. Don't rely on unstated assumptions about the codebase or author's intent.
7. Have provable impact on other parts of the code (not speculation).
8. Are clearly not intentional changes by the author.
9. Be particularly careful with untrusted user input and follow the specific guidelines to review.

## Untrusted User Input

1. Be careful with open redirects, they must always be checked to only go to trusted domains (?next_page=...)
2. Always flag SQL that is not parametrized
3. In systems with user supplied URL input, http fetches always need to be protected against access to local resources (intercept DNS resolver!)
4. Escape, don't sanitize if you have the option (eg: HTML escaping)

## Comment guidelines

1. Be clear about why the issue is a problem.
2. Communicate severity appropriately - don't exaggerate.
3. Be brief - at most 1 paragraph.
4. Keep code snippets under 3 lines, wrapped in inline code or code blocks.
5. Explicitly state scenarios/environments where the issue arises.
6. Use a matter-of-fact tone - helpful AI assistant, not accusatory.
7. Write for quick comprehension without close reading.
8. Avoid excessive flattery or unhelpful phrases like "Great job...".

## Review priorities

1. Call out newly added dependencies explicitly and explain why they're needed.
2. Prefer simple, direct solutions over wrappers or abstractions without clear value.
3. Favor fail-fast behavior; avoid logging-and-continue patterns that hide errors.
4. Prefer predictable production behavior; crashing is better than silent degradation.
5. Treat back pressure handling as critical to system stability.
6. Apply system-level thinking; flag changes that increase operational risk or on-call wakeups.
7. Ensure that errors are always checked against codes or stable identifiers, never error messages.

## Priority levels

Tag each finding with a priority level in the title:
- [P0] - Drop everything to fix. Blocking release/operations. Only for universal issues.
- [P1] - Urgent. Should be addressed in the next cycle.
- [P2] - Normal. To be fixed eventually.
- [P3] - Low. Nice to have.

## Output format

Provide your findings in a clear, structured format:
1. List each finding with its priority tag, file location, and explanation.
2. Keep line references as short as possible (avoid ranges over 5-10 lines).
3. At the end, provide an overall verdict: "correct" (no blocking issues) or "needs attention" (has blocking issues).
4. Ignore trivial style issues unless they obscure meaning or violate documented standards.

Output all findings the author would fix if they knew about them. If there are no qualifying findings, explicitly state the code looks good. Don't stop at the first finding - list every qualifying issue.`;

async function loadProjectReviewGuidelines(cwd: string): Promise<string | null> {
	let currentDir = path.resolve(cwd);

	while (true) {
		const piDir = path.join(currentDir, ".pi");
		const guidelinesPath = path.join(currentDir, "REVIEW_GUIDELINES.md");

		const piStats = await fs.stat(piDir).catch(() => null);
		if (piStats?.isDirectory()) {
			const guidelineStats = await fs.stat(guidelinesPath).catch(() => null);
			if (guidelineStats?.isFile()) {
				try {
					const content = await fs.readFile(guidelinesPath, "utf8");
					const trimmed = content.trim();
					return trimmed ? trimmed : null;
				} catch {
					return null;
				}
			}
			return null;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

/**
 * Get the merge base between HEAD and a branch
 */
async function getMergeBase(pi: ExtensionAPI, branch: string): Promise<string | null> {
	try {
		// First try to get the upstream tracking branch
		const { stdout: upstream, code: upstreamCode } = await pi.exec("git", [
			"rev-parse",
			"--abbrev-ref",
			`${branch}@{upstream}`,
		]);

		if (upstreamCode === 0 && upstream.trim()) {
			const { stdout: mergeBase, code } = await pi.exec("git", ["merge-base", "HEAD", upstream.trim()]);
			if (code === 0 && mergeBase.trim()) {
				return mergeBase.trim();
			}
		}

		// Fall back to using the branch directly
		const { stdout: mergeBase, code } = await pi.exec("git", ["merge-base", "HEAD", branch]);
		if (code === 0 && mergeBase.trim()) {
			return mergeBase.trim();
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Get list of local branches
 */
async function getLocalBranches(pi: ExtensionAPI): Promise<string[]> {
	const { stdout, code } = await pi.exec("git", ["branch", "--format=%(refname:short)"]);
	if (code !== 0) return [];
	return stdout
		.trim()
		.split("\n")
		.filter((b) => b.trim());
}

/**
 * Get list of recent commits
 */
async function getRecentCommits(pi: ExtensionAPI, limit: number = 10): Promise<Array<{ sha: string; title: string }>> {
	const { stdout, code } = await pi.exec("git", ["log", `--oneline`, `-n`, `${limit}`]);
	if (code !== 0) return [];

	return stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const [sha, ...rest] = line.trim().split(" ");
			return { sha, title: rest.join(" ") };
		});
}

/**
 * Check if there are uncommitted changes (staged, unstaged, or untracked)
 */
async function hasUncommittedChanges(pi: ExtensionAPI): Promise<boolean> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
	return code === 0 && stdout.trim().length > 0;
}

/**
 * Check if there are changes that would prevent switching branches
 * (staged or unstaged changes to tracked files - untracked files are fine)
 */
async function hasPendingChanges(pi: ExtensionAPI): Promise<boolean> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
	if (code !== 0) return false;

	const lines = stdout
		.trim()
		.split("\n")
		.filter((line) => line.trim());
	const trackedChanges = lines.filter((line) => !line.startsWith("??"));
	return trackedChanges.length > 0;
}

/**
 * Parse a PR reference (URL or number) and return the PR number
 */
function parsePrReference(ref: string): number | null {
	const trimmed = ref.trim();

	const num = parseInt(trimmed, 10);
	if (!isNaN(num) && num > 0) {
		return num;
	}

	const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
	if (urlMatch) {
		return parseInt(urlMatch[1], 10);
	}

	return null;
}

/**
 * Get PR information from GitHub CLI
 */
async function getPrInfo(
	pi: ExtensionAPI,
	prNumber: number,
): Promise<{ baseBranch: string; title: string; headBranch: string } | null> {
	const { stdout, code } = await pi.exec("gh", [
		"pr",
		"view",
		String(prNumber),
		"--json",
		"baseRefName,title,headRefName",
	]);

	if (code !== 0) return null;

	try {
		const data = JSON.parse(stdout);
		return {
			baseBranch: data.baseRefName,
			title: data.title,
			headBranch: data.headRefName,
		};
	} catch {
		return null;
	}
}

/**
 * Checkout a PR using GitHub CLI
 */
async function checkoutPr(pi: ExtensionAPI, prNumber: number): Promise<{ success: boolean; error?: string }> {
	const { stdout, stderr, code } = await pi.exec("gh", ["pr", "checkout", String(prNumber)]);

	if (code !== 0) {
		return { success: false, error: stderr || stdout || "Failed to checkout PR" };
	}

	return { success: true };
}

/**
 * Get the current branch name
 */
async function getCurrentBranch(pi: ExtensionAPI): Promise<string | null> {
	const { stdout, code } = await pi.exec("git", ["branch", "--show-current"]);
	if (code === 0 && stdout.trim()) {
		return stdout.trim();
	}
	return null;
}

/**
 * Get the default branch (main or master)
 */
async function getDefaultBranch(pi: ExtensionAPI): Promise<string> {
	const { stdout, code } = await pi.exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
	if (code === 0 && stdout.trim()) {
		return stdout.trim().replace("origin/", "");
	}

	const branches = await getLocalBranches(pi);
	if (branches.includes("main")) return "main";
	if (branches.includes("master")) return "master";

	return "main";
}

/**
 * Build the review prompt based on target
 */
async function buildReviewPrompt(pi: ExtensionAPI, target: ReviewTarget): Promise<string> {
	switch (target.type) {
		case "uncommitted":
			return UNCOMMITTED_PROMPT;

		case "baseBranch": {
			const mergeBase = await getMergeBase(pi, target.branch);
			if (mergeBase) {
				return BASE_BRANCH_PROMPT_WITH_MERGE_BASE.replace(/{baseBranch}/g, target.branch).replace(
					/{mergeBaseSha}/g,
					mergeBase,
				);
			}
			return BASE_BRANCH_PROMPT_FALLBACK.replace(/{branch}/g, target.branch);
		}

		case "commit":
			if (target.title) {
				return COMMIT_PROMPT_WITH_TITLE.replace("{sha}", target.sha).replace("{title}", target.title);
			}
			return COMMIT_PROMPT.replace("{sha}", target.sha);

		case "custom":
			return target.instructions;

		case "pullRequest": {
			const mergeBase = await getMergeBase(pi, target.baseBranch);
			if (mergeBase) {
				return PULL_REQUEST_PROMPT.replace(/{prNumber}/g, String(target.prNumber))
					.replace(/{title}/g, target.title)
					.replace(/{baseBranch}/g, target.baseBranch)
					.replace(/{mergeBaseSha}/g, mergeBase);
			}
			return PULL_REQUEST_PROMPT_FALLBACK.replace(/{prNumber}/g, String(target.prNumber))
				.replace(/{title}/g, target.title)
				.replace(/{baseBranch}/g, target.baseBranch);
		}
	}
}

/**
 * Get user-facing hint for the review target
 */
function getUserFacingHint(target: ReviewTarget): string {
	switch (target.type) {
		case "uncommitted":
			return "current changes";
		case "baseBranch":
			return `changes against '${target.branch}'`;
		case "commit": {
			const shortSha = target.sha.slice(0, 7);
			return target.title ? `commit ${shortSha}: ${target.title}` : `commit ${shortSha}`;
		}
		case "custom":
			return target.instructions.length > 40 ? target.instructions.slice(0, 37) + "..." : target.instructions;

		case "pullRequest": {
			const shortTitle = target.title.length > 30 ? target.title.slice(0, 27) + "..." : target.title;
			return `PR #${target.prNumber}: ${shortTitle}`;
		}
	}
}

// Review preset options for the selector
const REVIEW_PRESETS = [
	{ value: "pullRequest", label: "Review a pull request", description: "(GitHub PR)" },
	{ value: "baseBranch", label: "Review against a base branch", description: "(local)" },
	{ value: "uncommitted", label: "Review uncommitted changes", description: "" },
	{ value: "commit", label: "Review a commit", description: "" },
	{ value: "custom", label: "Custom review instructions", description: "" },
] as const;

interface SubagentResult {
	exitCode: number;
	output: string;
	stderr: string;
	model?: string;
	usage?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		turns: number;
	};
}

/**
 * Run a review as a subagent with the specified model and thinking level
 */
async function runSubagentReview(
	cwd: string,
	model: string,
	thinkingLevel: string,
	prompt: string,
	signal?: AbortSignal,
	onProgress?: (text: string) => void,
): Promise<SubagentResult> {
	const args: string[] = ["--mode", "json", "-p", "--no-session", "--model", model];
	if (thinkingLevel !== "off") {
		args.push("--thinking", thinkingLevel);
	}
	args.push(prompt);

	const result: SubagentResult = {
		exitCode: 0,
		output: "",
		stderr: "",
		model,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
	};

	let wasAborted = false;

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn("pi", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: any;
			try {
				event = JSON.parse(line);
			} catch {
				return;
			}

			if (event.type === "message_end" && event.message) {
				const msg = event.message as Message;

				if (msg.role === "assistant") {
					result.usage!.turns++;
					const usage = msg.usage;
					if (usage) {
						result.usage!.input += usage.input || 0;
						result.usage!.output += usage.output || 0;
						result.usage!.cacheRead += usage.cacheRead || 0;
						result.usage!.cacheWrite += usage.cacheWrite || 0;
						result.usage!.cost += usage.cost?.total || 0;
					}

					// Extract text content
					for (const part of msg.content) {
						if (part.type === "text") {
							result.output = part.text;
							onProgress?.(part.text);
						}
					}
				}
			}
		};

		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data) => {
			result.stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			resolve(code ?? 0);
		});

		proc.on("error", () => {
			resolve(1);
		});

		if (signal) {
			const killProc = () => {
				wasAborted = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) killProc();
			else signal.addEventListener("abort", killProc, { once: true });
		}
	});

	result.exitCode = exitCode;
	if (wasAborted) {
		result.exitCode = 130; // Standard "terminated by signal" code
		result.stderr = "Review was cancelled";
	}

	return result;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	return `${Math.round(count / 1000)}k`;
}

function formatUsageStats(usage: SubagentResult["usage"], model?: string): string {
	if (!usage) return "";
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

export default function reviewExtension(pi: ExtensionAPI) {
	/**
	 * Determine the smart default review type based on git state
	 */
	async function getSmartDefault(): Promise<"uncommitted" | "baseBranch" | "commit"> {
		if (await hasUncommittedChanges(pi)) {
			return "uncommitted";
		}

		const currentBranch = await getCurrentBranch(pi);
		const defaultBranch = await getDefaultBranch(pi);
		if (currentBranch && currentBranch !== defaultBranch) {
			return "baseBranch";
		}

		return "commit";
	}

	type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

	interface ModelSelection {
		model: string;
		thinkingLevel: ThinkingLevel;
	}

	/**
	 * Show model selector with current model as default and thinking level toggle
	 */
	async function showModelSelector(ctx: ExtensionContext): Promise<ModelSelection | null> {
		const currentModel = ctx.model;
		const currentThinking = pi.getThinkingLevel() as ThinkingLevel;
		// Only get models for providers with API keys configured
		const availableModels = await ctx.modelRegistry.getAvailable();

		// Build list with current model first
		const items: SelectItem[] = [];

		if (currentModel) {
			items.push({
				value: `${currentModel.provider}/${currentModel.id}`,
				label: `${currentModel.name} (current)`,
				description: currentModel.provider,
			});
		}

		for (const model of availableModels) {
			const modelKey = `${model.provider}/${model.id}`;
			// Skip if it's the current model (already added)
			if (currentModel && model.provider === currentModel.provider && model.id === currentModel.id) {
				continue;
			}
			items.push({
				value: modelKey,
				label: model.name,
				description: model.provider,
			});
		}

		const result = await ctx.ui.custom<ModelSelection | null>((tui, theme, _kb, done) => {
			let thinkingLevel: ThinkingLevel = currentThinking;

			const thinkingColors: Record<ThinkingLevel, string> = {
				off: "dim",
				minimal: "muted",
				low: "text",
				medium: "accent",
				high: "warning",
				xhigh: "error",
			};

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.searchable = true;
			selectList.onSelect = (item) => done({ model: item.value, thinkingLevel });
			selectList.onCancel = () => done(null);

			return {
				render(width: number) {
					const lines: string[] = [];
					const border = theme.fg("accent", "─".repeat(width));
					lines.push(border);
					lines.push(theme.fg("accent", theme.bold("Select model for review")));

					// Thinking level indicator
					const thinkingColor = thinkingColors[thinkingLevel];
					const thinkingDisplay = theme.fg("muted", "Thinking: ") + theme.fg(thinkingColor, thinkingLevel);
					lines.push(thinkingDisplay);

					lines.push("");
					lines.push(...selectList.render(width));
					lines.push("");
					lines.push(theme.fg("dim", "Type to filter • Shift+Tab thinking • enter select • esc cancel"));
					lines.push(border);
					return lines;
				},
				invalidate() {
					selectList.invalidate();
				},
				handleInput(data: string) {
					// Shift+Tab cycles thinking level
					if (matchesKey(data, "shift+tab")) {
						const currentIndex = THINKING_LEVELS.indexOf(thinkingLevel);
						const nextIndex = (currentIndex + 1) % THINKING_LEVELS.length;
						thinkingLevel = THINKING_LEVELS[nextIndex];
						tui.requestRender();
						return;
					}
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		return result;
	}

	/**
	 * Show the review preset selector
	 */
	async function showReviewSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const smartDefault = await getSmartDefault();
		const items: SelectItem[] = REVIEW_PRESETS.slice()
			.sort((a, b) => {
				if (a.value === smartDefault) return -1;
				if (b.value === smartDefault) return 1;
				return 0;
			})
			.map((preset) => ({
				value: preset.value,
				label: preset.label,
				description: preset.description,
			}));

		while (true) {
			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Select a review preset"))));

				const selectList = new SelectList(items, Math.min(items.length, 10), {
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.fg("accent", text),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				});

				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);

				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", "Press enter to confirm or esc to go back")));
				container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						selectList.handleInput(data);
						tui.requestRender();
					},
				};
			});

			if (!result) return null;

			switch (result) {
				case "uncommitted":
					return { type: "uncommitted" };

				case "baseBranch": {
					const target = await showBranchSelector(ctx);
					if (target) return target;
					break;
				}

				case "commit": {
					const target = await showCommitSelector(ctx);
					if (target) return target;
					break;
				}

				case "custom": {
					const target = await showCustomInput(ctx);
					if (target) return target;
					break;
				}

				case "pullRequest": {
					const target = await showPrInput(ctx);
					if (target) return target;
					break;
				}

				default:
					return null;
			}
		}
	}

	/**
	 * Show branch selector for base branch review
	 */
	async function showBranchSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const branches = await getLocalBranches(pi);
		const defaultBranch = await getDefaultBranch(pi);

		if (branches.length === 0) {
			ctx.ui.notify("No branches found", "error");
			return null;
		}

		const sortedBranches = branches.sort((a, b) => {
			if (a === defaultBranch) return -1;
			if (b === defaultBranch) return 1;
			return a.localeCompare(b);
		});

		const items: SelectItem[] = sortedBranches.map((branch) => ({
			value: branch,
			label: branch,
			description: branch === defaultBranch ? "(default)" : "",
		}));

		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Select base branch"))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.searchable = true;
			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "Type to filter • enter to select • esc to cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return null;
		return { type: "baseBranch", branch: result };
	}

	/**
	 * Show commit selector
	 */
	async function showCommitSelector(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const commits = await getRecentCommits(pi, 20);

		if (commits.length === 0) {
			ctx.ui.notify("No commits found", "error");
			return null;
		}

		const items: SelectItem[] = commits.map((commit) => ({
			value: commit.sha,
			label: `${commit.sha.slice(0, 7)} ${commit.title}`,
			description: "",
		}));

		const result = await ctx.ui.custom<{ sha: string; title: string } | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Select commit to review"))));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});

			selectList.searchable = true;
			selectList.onSelect = (item) => {
				const commit = commits.find((c) => c.sha === item.value);
				if (commit) {
					done(commit);
				} else {
					done(null);
				}
			};
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "Type to filter • enter to select • esc to cancel")));
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return null;
		return { type: "commit", sha: result.sha, title: result.title };
	}

	/**
	 * Show custom instructions input
	 */
	async function showCustomInput(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		const result = await ctx.ui.editor(
			"Enter review instructions:",
			"Review the code for security vulnerabilities and potential bugs...",
		);

		if (!result?.trim()) return null;
		return { type: "custom", instructions: result.trim() };
	}

	/**
	 * Show PR input and handle checkout
	 */
	async function showPrInput(ctx: ExtensionContext): Promise<ReviewTarget | null> {
		if (await hasPendingChanges(pi)) {
			ctx.ui.notify(
				"Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
				"error",
			);
			return null;
		}

		const prRef = await ctx.ui.editor(
			"Enter PR number or URL (e.g. 123 or https://github.com/owner/repo/pull/123):",
			"",
		);

		if (!prRef?.trim()) return null;

		const prNumber = parsePrReference(prRef);
		if (!prNumber) {
			ctx.ui.notify("Invalid PR reference. Enter a number or GitHub PR URL.", "error");
			return null;
		}

		ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
		const prInfo = await getPrInfo(pi, prNumber);

		if (!prInfo) {
			ctx.ui.notify(
				`Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
				"error",
			);
			return null;
		}

		if (await hasPendingChanges(pi)) {
			ctx.ui.notify(
				"Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
				"error",
			);
			return null;
		}

		ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
		const checkoutResult = await checkoutPr(pi, prNumber);

		if (!checkoutResult.success) {
			ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
			return null;
		}

		ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

		return {
			type: "pullRequest",
			prNumber,
			baseBranch: prInfo.baseBranch,
			title: prInfo.title,
		};
	}

	/**
	 * Execute the review as a subagent
	 */
	async function executeReview(
		ctx: ExtensionCommandContext,
		target: ReviewTarget,
		model: string,
		thinkingLevel: string,
	): Promise<void> {
		const prompt = await buildReviewPrompt(pi, target);
		const hint = getUserFacingHint(target);
		const projectGuidelines = await loadProjectReviewGuidelines(ctx.cwd);

		let fullPrompt = `${REVIEW_RUBRIC}\n\n---\n\nPlease perform a code review with the following focus:\n\n${prompt}`;

		if (projectGuidelines) {
			fullPrompt += `\n\nThis project has additional instructions for code reviews:\n\n${projectGuidelines}`;
		}

		const thinkingHint = thinkingLevel !== "off" ? ` (thinking: ${thinkingLevel})` : "";

		// Run review with loading UI
		const result = await ctx.ui.custom<SubagentResult | null>((tui, theme, _kb, done) => {
			const loader = new BorderedLoader(tui, theme, `Reviewing ${hint} with ${model}${thinkingHint}...`);
			const abortController = new AbortController();

			loader.onAbort = () => {
				abortController.abort();
				done(null);
			};

			runSubagentReview(ctx.cwd, model, thinkingLevel, fullPrompt, abortController.signal, (text) => {
				// Update loading message with progress
				const lines = text.split("\n").length;
				loader.message = `Reviewing ${hint} with ${model}${thinkingHint}... (${lines} lines)`;
				tui.requestRender();
			})
				.then(done)
				.catch((err) => {
					done({
						exitCode: 1,
						output: "",
						stderr: err instanceof Error ? err.message : String(err),
						model,
					});
				});

			return loader;
		});

		if (!result) {
			ctx.ui.notify("Review cancelled", "info");
			return;
		}

		if (result.exitCode !== 0) {
			ctx.ui.notify(`Review failed: ${result.stderr || "Unknown error"}`, "error");
			return;
		}

		// Display results
		const usageStr = formatUsageStats(result.usage, result.model);

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const container = new Container();
			const mdTheme = getMarkdownTheme();

			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			container.addChild(
				new Text(theme.fg("accent", theme.bold(`Code Review: ${hint}`)) + theme.fg("dim", ` (${model})`), 0, 0),
			);
			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

			if (result.output) {
				container.addChild(new Markdown(result.output.trim(), 0, 0, mdTheme));
			} else {
				container.addChild(new Text(theme.fg("muted", "(No output from review)"), 0, 0));
			}

			container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
			if (usageStr) {
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
			container.addChild(new Text(theme.fg("dim", "Press any key to close"), 0, 0));

			let scrollOffset = 0;
			const maxScroll = 1000; // Arbitrary large number

			return {
				render(width: number) {
					const lines = container.render(width);
					const visibleHeight = tui.height - 2;
					return lines.slice(scrollOffset, scrollOffset + visibleHeight);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					// Scroll support
					if (data === "\x1b[A" || data === "k") {
						// Up
						scrollOffset = Math.max(0, scrollOffset - 1);
						tui.requestRender();
						return;
					}
					if (data === "\x1b[B" || data === "j") {
						// Down
						scrollOffset = Math.min(maxScroll, scrollOffset + 1);
						tui.requestRender();
						return;
					}
					if (data === "\x1b[5~" || data === "u") {
						// Page up
						scrollOffset = Math.max(0, scrollOffset - 10);
						tui.requestRender();
						return;
					}
					if (data === "\x1b[6~" || data === "d") {
						// Page down
						scrollOffset = Math.min(maxScroll, scrollOffset + 10);
						tui.requestRender();
						return;
					}
					// Any other key closes
					done();
				},
			};
		});

		// Inject review result as a message so it's in the session history
		const modelInfo = thinkingLevel !== "off" ? `${model} (thinking: ${thinkingLevel})` : model;
		pi.sendMessage(
			{
				customType: "code-review",
				content: `## Code Review: ${hint}\n\n**Model:** ${modelInfo}\n\n${result.output}`,
				display: true,
				details: {
					target: hint,
					model,
					thinkingLevel,
					usage: result.usage,
				},
			},
			{ triggerTurn: false },
		);

		ctx.ui.notify("Review complete!", "info");
	}

	/**
	 * Parse command arguments for direct invocation
	 */
	function parseArgs(args: string | undefined): ReviewTarget | { type: "pr"; ref: string } | null {
		if (!args?.trim()) return null;

		const parts = args.trim().split(/\s+/);
		const subcommand = parts[0]?.toLowerCase();

		switch (subcommand) {
			case "uncommitted":
				return { type: "uncommitted" };

			case "branch": {
				const branch = parts[1];
				if (!branch) return null;
				return { type: "baseBranch", branch };
			}

			case "commit": {
				const sha = parts[1];
				if (!sha) return null;
				const title = parts.slice(2).join(" ") || undefined;
				return { type: "commit", sha, title };
			}

			case "custom": {
				const instructions = parts.slice(1).join(" ");
				if (!instructions) return null;
				return { type: "custom", instructions };
			}

			case "pr": {
				const ref = parts[1];
				if (!ref) return null;
				return { type: "pr", ref };
			}

			default:
				return null;
		}
	}

	/**
	 * Handle PR checkout and return a ReviewTarget (or null on failure)
	 */
	async function handlePrCheckout(ctx: ExtensionContext, ref: string): Promise<ReviewTarget | null> {
		if (await hasPendingChanges(pi)) {
			ctx.ui.notify(
				"Cannot checkout PR: you have uncommitted changes. Please commit or stash them first.",
				"error",
			);
			return null;
		}

		const prNumber = parsePrReference(ref);
		if (!prNumber) {
			ctx.ui.notify("Invalid PR reference. Enter a number or GitHub PR URL.", "error");
			return null;
		}

		ctx.ui.notify(`Fetching PR #${prNumber} info...`, "info");
		const prInfo = await getPrInfo(pi, prNumber);

		if (!prInfo) {
			ctx.ui.notify(
				`Could not find PR #${prNumber}. Make sure gh is authenticated and the PR exists.`,
				"error",
			);
			return null;
		}

		ctx.ui.notify(`Checking out PR #${prNumber}...`, "info");
		const checkoutResult = await checkoutPr(pi, prNumber);

		if (!checkoutResult.success) {
			ctx.ui.notify(`Failed to checkout PR: ${checkoutResult.error}`, "error");
			return null;
		}

		ctx.ui.notify(`Checked out PR #${prNumber} (${prInfo.headBranch})`, "info");

		return {
			type: "pullRequest",
			prNumber,
			baseBranch: prInfo.baseBranch,
			title: prInfo.title,
		};
	}

	// Register the /review command
	pi.registerCommand("review", {
		description: "Review code changes as a subagent (with model selection)",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Review requires interactive mode", "error");
				return;
			}

			// Check if we're in a git repository
			const { code } = await pi.exec("git", ["rev-parse", "--git-dir"]);
			if (code !== 0) {
				ctx.ui.notify("Not a git repository", "error");
				return;
			}

			// Try to parse direct arguments
			let target: ReviewTarget | null = null;
			let fromSelector = false;
			const parsed = parseArgs(args);

			if (parsed) {
				if (parsed.type === "pr") {
					target = await handlePrCheckout(ctx, parsed.ref);
					if (!target) {
						ctx.ui.notify("PR review failed. Returning to review menu.", "warning");
					}
				} else {
					target = parsed;
				}
			}

			if (!target) {
				fromSelector = true;
			}

			while (true) {
				if (!target && fromSelector) {
					target = await showReviewSelector(ctx);
				}

				if (!target) {
					ctx.ui.notify("Review cancelled", "info");
					return;
				}

				// Show model selector (with thinking level toggle)
				const selection = await showModelSelector(ctx);
				if (!selection) {
					if (fromSelector) {
						target = null;
						continue;
					}
					ctx.ui.notify("Review cancelled", "info");
					return;
				}

				await executeReview(ctx, target, selection.model, selection.thinkingLevel);
				return;
			}
		},
	});

	// Register custom message renderer for review results
	pi.registerMessageRenderer("code-review", (message, { expanded }, theme) => {
		const details = message.details as {
			target?: string;
			model?: string;
			thinkingLevel?: string;
			usage?: SubagentResult["usage"];
		} | undefined;
		const mdTheme = getMarkdownTheme();

		const container = new Container();

		let header = theme.fg("accent", theme.bold("📋 Code Review"));
		if (details?.target) {
			header += theme.fg("dim", ` - ${details.target}`);
		}
		if (details?.model) {
			const thinkingInfo = details.thinkingLevel && details.thinkingLevel !== "off"
				? ` [${details.thinkingLevel}]`
				: "";
			header += theme.fg("muted", ` (${details.model}${thinkingInfo})`);
		}
		container.addChild(new Text(header, 0, 0));

		if (expanded && message.content) {
			container.addChild(new Markdown(message.content, 0, 0, mdTheme));
		} else if (message.content) {
			// Show collapsed preview
			const lines = message.content.split("\n").slice(0, 5);
			const preview = lines.join("\n") + (message.content.split("\n").length > 5 ? "\n..." : "");
			container.addChild(new Text(theme.fg("dim", preview), 0, 0));
			container.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 0, 0));
		}

		if (details?.usage) {
			const usageStr = formatUsageStats(details.usage);
			if (usageStr) {
				container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
			}
		}

		return container;
	});
}
