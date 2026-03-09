import { afterEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
	spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import tmuxManagerExtension from "./index";

afterEach(() => {
	spawnSyncMock.mockReset();
	vi.restoreAllMocks();
});

describe("tmux-manager extension", () => {
	it("lists only managed tmux sessions via /tmux list", async () => {
		const handlers: Record<string, (...args: any[]) => unknown> = {};
		let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;

		const pi = {
			on: (eventName: string, handler: (...args: any[]) => unknown) => {
				handlers[eventName] = handler;
			},
			registerCommand: (_name: string, config: { handler: (args: string, ctx: any) => Promise<void> }) => {
				commandHandler = config.handler;
			},
		};

		tmuxManagerExtension(pi as never);
		expect(commandHandler).toBeDefined();

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: [
				"agent-session\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent.log\tpa -p review",
				"non-agent\t$2\t1\t0\t1700000100\t\t\t\t",
			].join("\n"),
			stderr: "",
			error: undefined,
		});

		const notify = vi.fn();
		await commandHandler!("list", {
			ui: {
				notify,
				select: vi.fn(),
			},
		});

		expect(notify).toHaveBeenCalledTimes(1);
		const message = notify.mock.calls[0]?.[0] as string;
		expect(message).toContain("agent-session");
		expect(message).not.toContain("non-agent");
	});

	it("updates footer status with tmux count on session start", async () => {
		const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

		const pi = {
			on: (eventName: string, handler: (...args: any[]) => Promise<void>) => {
				handlers[eventName] = handler;
			},
			registerCommand: vi.fn(),
		};

		tmuxManagerExtension(pi as never);

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "agent-session\t$1\t1\t0\t1700000000\t1\tcode-review\t/tmp/agent.log\tpa -p review",
			stderr: "",
			error: undefined,
		});

		const setStatus = vi.fn();
		const ctx = {
			hasUI: true,
			ui: {
				setStatus,
				theme: {
					fg: (_tone: string, text: string) => text,
				},
			},
		};

		await handlers.session_start?.({}, ctx);
		expect(setStatus).toHaveBeenCalled();

		const statusUpdate = setStatus.mock.calls.find((call) => call[0] === "tmux-sessions");
		expect(statusUpdate?.[1]).toContain("tmux:1");

		await handlers.session_shutdown?.({}, ctx);
	});

	it("hides tmux footer status when there are no managed tmux sessions", async () => {
		const handlers: Record<string, (...args: any[]) => Promise<void>> = {};

		const pi = {
			on: (eventName: string, handler: (...args: any[]) => Promise<void>) => {
				handlers[eventName] = handler;
			},
			registerCommand: vi.fn(),
		};

		tmuxManagerExtension(pi as never);

		spawnSyncMock.mockReturnValue({
			status: 0,
			stdout: "",
			stderr: "",
			error: undefined,
		});

		const setStatus = vi.fn();
		const ctx = {
			hasUI: true,
			ui: {
				setStatus,
				theme: {
					fg: (_tone: string, text: string) => text,
				},
			},
		};

		await handlers.session_start?.({}, ctx);
		expect(setStatus).toHaveBeenCalledWith("tmux-sessions", undefined);
	});
});
