import { getCapabilities, type TUI } from "@mariozechner/pi-tui";
import type { RenderBackend, RuntimeOptions } from "./runtime.js";

export function isITermSession(env: NodeJS.ProcessEnv = process.env): boolean {
	const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
	const lcTerminal = (env.LC_TERMINAL ?? "").toLowerCase();
	return Boolean(env.ITERM_SESSION_ID) || termProgram === "iterm.app" || lcTerminal === "iterm2";
}

export function getRenderBackend(options: RuntimeOptions): RenderBackend {
	if (options.forceAnsi) return "ansi";
	if (isITermSession()) return "ansi";
	return getCapabilities().images === "kitty" ? "kitty" : "ansi";
}

export function supportsHeldKeys(tui: TUI): boolean {
	return Boolean(tui.terminal?.kittyProtocolActive);
}
