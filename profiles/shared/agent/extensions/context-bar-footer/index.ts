/**
 * Context Bar Footer Extension
 *
 * Clean single-line footer with git status and progress indicator
 * Layout: [path (branch +2 ~3)]  ────────────────  [$cost • ▰▰▰▱▱ 5% • model]
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { execSync } from "child_process";

// Cache git status to avoid running on every render
let gitStatusCache: { status: string; timestamp: number } | null = null;
const GIT_STATUS_TTL = 2000; // 2 seconds

function getGitStatus(): string {
	const now = Date.now();
	if (gitStatusCache && now - gitStatusCache.timestamp < GIT_STATUS_TTL) {
		return gitStatusCache.status;
	}

	try {
		const output = execSync("git status --porcelain 2>/dev/null", {
			encoding: "utf-8",
			timeout: 1000,
		});

		let staged = 0;
		let modified = 0;
		let untracked = 0;

		for (const line of output.split("\n")) {
			if (!line) continue;
			const index = line[0];
			const worktree = line[1];

			// Staged changes (index has non-space, non-?)
			if (index !== " " && index !== "?") staged++;
			// Modified in worktree
			if (worktree === "M" || worktree === "D") modified++;
			// Untracked
			if (index === "?") untracked++;
		}

		const parts: string[] = [];
		if (staged > 0) parts.push(`+${staged}`);
		if (modified > 0) parts.push(`~${modified}`);
		if (untracked > 0) parts.push(`?${untracked}`);

		const status = parts.length > 0 ? " " + parts.join(" ") : "";
		gitStatusCache = { status, timestamp: now };
		return status;
	} catch {
		gitStatusCache = { status: "", timestamp: now };
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	let enabled = false;

	pi.on("session_start", async (_event, ctx) => {
		if (!enabled) {
			enableFooter(ctx);
			enabled = true;
		}
	});

	function enableFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {
					// Clear cache when invalidated
					gitStatusCache = null;
				},
				render(width: number): string[] {
					// Calculate cumulative cost
					let totalCost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const m = entry.message as AssistantMessage;
							totalCost += m.usage.cost.total;
						}
					}

					// Get context usage
					const contextUsage = ctx.getContextUsage();
					const contextTokens = contextUsage?.tokens || 0;
					const contextWindow = ctx.model?.contextWindow || 200000;
					const contextPercent = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

					// === LEFT SIDE: path (branch +staged ~modified ?untracked) ===
					let pwd = process.cwd();
					const home = process.env.HOME || process.env.USERPROFILE;
					if (home && pwd.startsWith(home)) {
						pwd = `~${pwd.slice(home.length)}`;
					}

					const branch = footerData.getGitBranch();
					const gitStatus = getGitStatus();
					if (branch) {
						pwd = `${pwd} (${branch}${gitStatus})`;
					}

					// === RIGHT SIDE: cost • progress • model ===
					const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
					const costStr = `$${totalCost.toFixed(2)}${usingSubscription ? " sub" : ""}`;

					// Minimal progress bar (5 segments)
					const barWidth = 5;
					const filled = Math.min(barWidth, Math.round((contextPercent / 100) * barWidth));
					
					const bar = "▰".repeat(filled) + "▱".repeat(barWidth - filled);
					const pctStr = `${Math.round(contextPercent)}%`;

					const modelName = ctx.model?.id || "no-model";
					// Shorten common model names
					const shortModel = modelName
						.replace("claude-", "")
						.replace("-20250514", "");

					const rightParts = [costStr, `${bar} ${pctStr}`, shortModel];
					const rightStr = rightParts.join(theme.fg("dim", "  •  "));

					// === LAYOUT ===
					const leftWidth = visibleWidth(pwd);
					const rightWidth = visibleWidth(rightStr);
					const gap = width - leftWidth - rightWidth;

					if (gap >= 2) {
						// Everything fits
						const padding = " ".repeat(gap);
						return [theme.fg("dim", pwd) + padding + rightStr];
					} else {
						// Truncate path
						const maxPwd = width - rightWidth - 2;
						const truncatedPwd = truncateToWidth(pwd, maxPwd, "…");
						const newGap = width - visibleWidth(truncatedPwd) - rightWidth;
						const padding = " ".repeat(Math.max(1, newGap));
						return [theme.fg("dim", truncatedPwd) + padding + rightStr];
					}
				},
			};
		});
	}

	pi.registerCommand("context-footer", {
		description: "Toggle context bar footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				enableFooter(ctx);
				ctx.ui.notify("Context bar footer enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}
		},
	});
}
