import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import contextBarExtension from "./context-bar";

const originalHome = process.env.HOME;

afterEach(() => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	vi.restoreAllMocks();
});

describe("context-bar extension", () => {
	it("combines model and thinking level into one footer segment", async () => {
		const home = mkdtempSync(join(tmpdir(), "pa-context-bar-home-"));
		process.env.HOME = home;

		const handlers: Record<string, (event: unknown, ctx: any) => Promise<void>> = {};
		const registerCommand = vi.fn();
		const appendEntry = vi.fn();
		const getThinkingLevel = vi.fn(() => "xhigh");

		contextBarExtension({
			on: (eventName: string, handler: (event: unknown, ctx: any) => Promise<void>) => {
				handlers[eventName] = handler;
			},
			registerCommand,
			appendEntry,
			getThinkingLevel,
		} as never);

		expect(registerCommand).toHaveBeenCalled();

		const setFooter = vi.fn();
		const ctx = {
			cwd: join(home, "personal-agent"),
			model: {
				id: "gpt-5.4",
				contextWindow: 200000,
			},
			getContextUsage: () => ({ tokens: 1000 }),
			getSystemPrompt: () => "system prompt",
			sessionManager: {
				getEntries: () => [],
				getBranch: () => [],
			},
			ui: {
				setFooter,
				notify: vi.fn(),
			},
		};

		await handlers.session_start?.({}, ctx);
		expect(setFooter).toHaveBeenCalledTimes(1);

		const renderFactory = setFooter.mock.calls[0]?.[0] as (tui: any, theme: any, footerData: any) => { render: (width: number) => string[] };
		const renderable = renderFactory(
			{ requestRender: vi.fn() },
			{
				fg: (_tone: string, text: string) => text,
			},
			{
				onBranchChange: () => () => {},
				getGitBranch: () => "main",
				getExtensionStatuses: () => new Map(),
			},
		);

		const [line] = renderable.render(240);
		expect(line).toContain("🤖 gpt-5.4 xhigh");
		expect(line).not.toContain("💭 xhigh");

		rmSync(home, { recursive: true, force: true });
	});
});
