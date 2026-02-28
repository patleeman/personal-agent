/**
 * Context Bar — Adds a segmented role breakdown line below the default footer.
 *
 * Line 1: default footer (📁 dir │ ⎇ branch │ 🤖 model │ 💭 thinking │ ctx: ████░ 85%)
 * Line 2: color-coded breakdown by role (sys / user / assistant / tool)
 *
 * Toggle with /context-bar
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function getGlobalStatePath(): string | undefined {
	const home = process.env.HOME;
	if (!home) return undefined;
	return join(home, ".pi", "agent", "context-bar-state.json");
}

function readGlobalState(): boolean | undefined {
	const statePath = getGlobalStatePath();
	if (!statePath) return undefined;

	try {
		const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { enabled?: unknown };
		return typeof parsed.enabled === "boolean" ? parsed.enabled : undefined;
	} catch {
		return undefined;
	}
}

function writeGlobalState(enabled: boolean): void {
	const statePath = getGlobalStatePath();
	if (!statePath) return;

	try {
		mkdirSync(dirname(statePath), { recursive: true });
		writeFileSync(statePath, JSON.stringify({ enabled }, null, 2));
	} catch {
		// ignore persistence errors
	}
}

function estimateTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

function contentLength(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (Array.isArray(content)) {
		let len = 0;
		for (const block of content as any[]) {
			if (block.type === "text") len += (block.text ?? "").length;
			else if (block.type === "thinking") len += (block.thinking ?? "").length;
			else if (block.type === "toolCall") len += JSON.stringify(block.arguments ?? {}).length + (block.name ?? "").length;
			else if (block.type === "image") len += 1000;
		}
		return len;
	}
	return 0;
}

export default function (pi: ExtensionAPI) {
	const STATE_ENTRY_TYPE = "context-bar-state";
	let enabled = false;

	function readSessionState(ctx: ExtensionContext): boolean | undefined {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as any;
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
			if (entry.data?.enabled === true) return true;
			if (entry.data?.enabled === false) return false;
		}
		return undefined;
	}

	function persistState() {
		pi.appendEntry(STATE_ENTRY_TYPE, { enabled });
		writeGlobalState(enabled);
	}

	function restoreState(ctx: ExtensionContext) {
		const globalState = readGlobalState();
		const sessionState = readSessionState(ctx);

		enabled = globalState ?? sessionState ?? true;
		if (globalState === undefined && sessionState !== undefined) {
			writeGlobalState(sessionState);
		}

		if (enabled) applyFooter(ctx);
		else ctx.ui.setFooter(undefined);
	}

	function applyFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					// ── Gather data ──────────────────────────────────────────────
					const branch = ctx.sessionManager.getBranch();
					const usage = ctx.getContextUsage();
					const contextWindow = ctx.model?.contextWindow ?? 200000;

					let systemChars = 0, userChars = 0, assistantChars = 0, toolChars = 0;
					let totalCost = 0;

					systemChars = ctx.getSystemPrompt().length;

					for (const entry of branch) {
						if (entry.type !== "message") continue;
						const msg = entry.message;
						if (msg.role === "user") {
							userChars += contentLength(msg.content);
						} else if (msg.role === "assistant") {
							assistantChars += contentLength(msg.content);
							const am = msg as AssistantMessage;
							totalCost += am.usage?.cost?.total ?? 0;
						} else if (msg.role === "toolResult") {
							toolChars += contentLength(msg.content);
						}
					}

					const totalChars = systemChars + userChars + assistantChars + toolChars;

					// Use reported tokens if available and non-zero, else estimate
					const usedTokens = (usage?.tokens ?? 0) > 0
						? usage!.tokens!
						: estimateTokens(totalChars);
					const pct = Math.min(100, Math.round((usedTokens / contextWindow) * 100));

					const sep = theme.fg("dim", " │ ");

					// ── Build segmented bar ──────────────────────────────────────
					const segments: { chars: number; fg: (s: string) => string; label: string }[] = [];
					if (systemChars > 0) segments.push({ chars: systemChars, fg: (s) => theme.fg("muted", s), label: "sys" });
					if (userChars > 0) segments.push({ chars: userChars, fg: (s) => theme.fg("accent", s), label: "usr" });
					if (assistantChars > 0) segments.push({ chars: assistantChars, fg: (s) => theme.fg("success", s), label: "ast" });
					if (toolChars > 0) segments.push({ chars: toolChars, fg: (s) => theme.fg("warning", s), label: "tool" });

					const BAR_WIDTH = 20;
					const barFilled = Math.round((usedTokens / contextWindow) * BAR_WIDTH);
					let segBar = "";
					let remaining = barFilled;
					for (const seg of segments) {
						const w = totalChars > 0
							? Math.min(Math.max(1, Math.round((seg.chars / totalChars) * barFilled)), remaining)
							: 0;
						if (w > 0) { segBar += seg.fg("█".repeat(w)); remaining -= w; }
					}
					if (remaining > 0 && segments.length > 0)
						segBar += segments[segments.length - 1]!.fg("█".repeat(remaining));
					segBar += theme.fg("dim", "░".repeat(Math.max(0, BAR_WIDTH - barFilled)));

					// ── Compact legend: s:2% u:0% a:0% t:14% ──────────────────────
					// Percentages are each role's share of the total context window.
					const legendParts = segments.map(seg => {
						const segPct = Math.round((estimateTokens(seg.chars) / contextWindow) * 100);
						const shortLabel = seg.label === "sys"
							? "s"
							: seg.label === "usr"
								? "u"
								: seg.label === "ast"
									? "a"
									: "t";
						return seg.fg(`${shortLabel}:${segPct}%`);
					});
					const legend = legendParts.join(theme.fg("dim", " "));

					// ── Single line ───────────────────────────────────────────────
					const home = process.env.HOME ?? "";
					const cwd = ctx.cwd.replace(home, "~");
					const gitBranch = footerData.getGitBranch();
					const modelId = ctx.model?.id ?? "no-model";
					const thinkingLevel = pi.getThinkingLevel();

					const leftParts: string[] = [theme.fg("dim", `📁 ${cwd}`)];
					if (gitBranch) leftParts.push(theme.fg("dim", `⎇ ${gitBranch}`));
					leftParts.push(theme.fg("dim", `🤖 ${modelId}`));
					leftParts.push(theme.fg("dim", `💭 ${thinkingLevel}`));

					const extensionStatuses = Array.from(footerData.getExtensionStatuses().values())
						.filter((status) => status.trim().length > 0);
					const bgStatusIndex = extensionStatuses.findIndex((status) => status.includes("bg:"));
					const bgStatus = bgStatusIndex >= 0 ? extensionStatuses[bgStatusIndex] : undefined;
					if (bgStatus) leftParts.push(bgStatus);
					const rightExtensionStatuses = extensionStatuses.filter((_, index) => index !== bgStatusIndex);

					const rightParts: string[] = [
						`${segBar} ${theme.fg("dim", `${pct}%`)}`,
						legend,
						theme.fg("dim", `$${totalCost.toFixed(3)}`),
						...rightExtensionStatuses,
					].filter((part) => part.length > 0);

					const left = leftParts.join(sep);
					const right = rightParts.join(sep);
					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

					return [truncateToWidth(left + pad + right, width)];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		restoreState(ctx);
	});

	pi.registerCommand("context-bar", {
		description: "Toggle segmented context usage bar in footer",
		handler: async (_args, ctx) => {
			enabled = !enabled;

			if (enabled) {
				applyFooter(ctx);
				ctx.ui.notify("Context bar enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
			}

			persistState();
		},
	});
}
