import { isKeyRelease, Key, matchesKey, truncateToWidth, visibleWidth, type TUI } from "@mariozechner/pi-tui";
import {
	ANSI_MAX_COLUMNS,
	ANSI_MAX_ROWS,
	ANSI_RENDER_FPS,
	EMULATOR_FRAME_MS,
	GB_HEIGHT,
	GB_WIDTH,
	IMAGE_RENDER_FPS,
	MAX_CATCHUP_STEPS,
	TAP_FRAMES_ACTION,
	TAP_FRAMES_DIRECTION,
	VIEWPORT_SAFETY_ROWS,
} from "./constants.js";
import { AudioOutput } from "./audio-output.js";
import { KEYMAP, type GameboyInstance, type GameboyKey, createGameboy } from "./gameboy.js";
import { renderAnsiFrame } from "./render/ansi.js";
import { KittyRenderer } from "./render/kitty.js";
import { getRenderBackend, supportsHeldKeys } from "./terminal.js";
import type { RuntimeOptions } from "./runtime.js";

interface InputMapping {
	key: GameboyKey;
	hold: boolean;
}

export interface PiBoyExitResult {
	suspendState?: Buffer;
	suspendError?: string;
}

export class PiBoyComponent {
	wantsKeyRelease = true;

	private readonly gb: GameboyInstance;
	private readonly audioOutput: AudioOutput;
	private readonly kittyRenderer = new KittyRenderer();
	private readonly heldKeys = new Set<GameboyKey>();
	private readonly tapFrames = new Map<GameboyKey, number>();

	private interval: ReturnType<typeof setInterval> | null = null;
	private screen: ArrayLike<number> | null = null;
	private audioEnabled = false;
	private audioStarting = false;
	private audioStatus = "audio: muted";
	private lastAudioToggleMs = 0;
	private version = 0;
	private frameAccumulatorMs = 0;
	private renderAccumulatorMs = 0;
	private lastTickMs = performance.now();
	private previousClearOnShrink: boolean | null = null;
	private cachedWidth = 0;
	private cachedVersion = -1;
	private cachedLines: string[] = [];
	private coreError: string | null = null;
	private stateStatus = "state: fresh";

	constructor(
		private readonly tui: TUI,
		rom: Buffer,
		private readonly onClose: (result: PiBoyExitResult) => void,
		private readonly options: RuntimeOptions,
		initialState?: Buffer,
	) {
		this.audioOutput = new AudioOutput(options.audioBackendPreference);
		this.gb = createGameboy();
		this.gb.loadRom(rom);
		if (initialState && initialState.length > 0) {
			try {
				this.gb.loadState(initialState);
				this.stateStatus = "state: resumed";
			} catch {
				this.stateStatus = "state: resume failed";
			}
		}
		this.screen = this.gb.getScreen();
		this.previousClearOnShrink = this.tui.getClearOnShrink();
		this.tui.setClearOnShrink(true);
		this.tui.requestRender(true);
		this.startLoop();
	}

	private startLoop(): void {
		this.lastTickMs = performance.now();
		this.interval = setInterval(() => {
			if (this.coreError) return;

			const now = performance.now();
			const deltaMs = Math.min(250, now - this.lastTickMs);
			this.lastTickMs = now;
			this.frameAccumulatorMs += deltaMs;
			this.renderAccumulatorMs += deltaMs;

			let stepsRun = 0;
			while (this.frameAccumulatorMs >= EMULATOR_FRAME_MS && stepsRun < MAX_CATCHUP_STEPS) {
				try {
					this.runEmulatorStep();
				} catch (error) {
					this.failCore(error);
					return;
				}
				this.frameAccumulatorMs -= EMULATOR_FRAME_MS;
				stepsRun++;
			}

			if (stepsRun === MAX_CATCHUP_STEPS) {
				this.frameAccumulatorMs = 0;
			}

			const renderBackend = getRenderBackend(this.options);
			const renderFrameMs = 1000 / (renderBackend === "ansi" ? ANSI_RENDER_FPS : IMAGE_RENDER_FPS);
			if (this.renderAccumulatorMs >= renderFrameMs) {
				this.renderAccumulatorMs %= renderFrameMs;
				this.requestRender();
			}
		}, 8);
	}

	private requestRender(): void {
		this.version++;
		this.tui.requestRender();
	}

	private failCore(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.coreError = message.trim().length > 0 ? message.trim() : "unknown core error";
		this.audioEnabled = false;
		this.audioStarting = false;
		this.audioStatus = "audio: unavailable";
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.audioOutput.close();
		this.gb.dispose?.();
		this.requestRender();
	}

	private runEmulatorStep(): void {
		const pressedKeys = new Set<GameboyKey>(this.heldKeys);
		for (const [key, framesLeft] of this.tapFrames) {
			if (framesLeft <= 0) {
				this.tapFrames.delete(key);
				continue;
			}
			pressedKeys.add(key);
			if (framesLeft === 1) {
				this.tapFrames.delete(key);
			} else {
				this.tapFrames.set(key, framesLeft - 1);
			}
		}

		if (pressedKeys.size > 0) {
			this.gb.pressKeys([...pressedKeys]);
		}

		this.screen = this.gb.doFrame();
		this.kittyRenderer.invalidate();
		if (this.audioEnabled) {
			const wroteAudio = this.audioOutput.writeSamples(this.gb.getAudio(), this.gb.getAudioSampleRate());
			if (!wroteAudio) {
				this.audioEnabled = false;
				this.audioStatus = "audio: unavailable";
				this.requestRender();
			}
		}
	}

	private async toggleAudio(): Promise<void> {
		if (this.audioEnabled || this.audioStarting) {
			this.audioEnabled = false;
			this.audioStarting = false;
			this.audioOutput.close();
			this.audioStatus = "audio: muted";
			this.requestRender();
			return;
		}

		if (this.coreError) {
			this.audioEnabled = false;
			this.audioStarting = false;
			this.audioStatus = "audio: unavailable";
			this.requestRender();
			return;
		}

		this.audioStarting = true;
		this.audioStatus = "audio: starting";
		this.requestRender();
		try {
			await this.audioOutput.init();
			if (!this.audioStarting) {
				this.audioOutput.close();
				return;
			}
			this.gb.getAudio();
			this.audioStarting = false;
			this.audioEnabled = true;
			const backend = this.audioOutput.getBackendLabel();
			this.audioStatus = backend === "none" ? "audio: on" : `audio: on (${backend})`;
		} catch {
			this.audioEnabled = false;
			this.audioStarting = false;
			this.audioStatus = "audio: unavailable";
			this.audioOutput.close();
		}
		this.requestRender();
	}

	private mapInput(data: string): InputMapping | undefined {
		if (matchesKey(data, Key.left) || matchesKey(data, "a")) return { key: KEYMAP.LEFT, hold: true };
		if (matchesKey(data, Key.right) || matchesKey(data, "d")) return { key: KEYMAP.RIGHT, hold: true };
		if (matchesKey(data, Key.up) || matchesKey(data, "w")) return { key: KEYMAP.UP, hold: true };
		if (matchesKey(data, Key.down) || matchesKey(data, "s")) return { key: KEYMAP.DOWN, hold: true };
		if (matchesKey(data, "x") || matchesKey(data, "k")) return { key: KEYMAP.A, hold: false };
		if (matchesKey(data, "z") || matchesKey(data, "j")) return { key: KEYMAP.B, hold: false };
		if (matchesKey(data, Key.enter) || matchesKey(data, "p")) return { key: KEYMAP.START, hold: false };
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.backspace)) return { key: KEYMAP.SELECT, hold: false };
		return undefined;
	}

	private captureSuspendResult(): PiBoyExitResult {
		if (this.coreError) {
			return { suspendError: "core unavailable" };
		}

		try {
			const suspendState = this.gb.saveState();
			if (suspendState.length === 0) {
				return { suspendError: "empty state" };
			}
			return { suspendState };
		} catch (error) {
			return {
				suspendError: error instanceof Error ? error.message : String(error),
			};
		}
	}

	handleInput(data: string): void {
		const released = isKeyRelease(data);
		if (!released && (matchesKey(data, Key.escape) || matchesKey(data, "q"))) {
			const exitResult = this.captureSuspendResult();
			this.dispose();
			this.onClose(exitResult);
			return;
		}

		if (!released && matchesKey(data, "m")) {
			const now = performance.now();
			if (now - this.lastAudioToggleMs > 250) {
				this.lastAudioToggleMs = now;
				void this.toggleAudio();
			}
			return;
		}

		const mapped = this.mapInput(data);
		if (!mapped) return;

		if (released) {
			if (mapped.hold) {
				this.heldKeys.delete(mapped.key);
			}
			return;
		}

		if (mapped.hold && supportsHeldKeys(this.tui)) {
			this.heldKeys.add(mapped.key);
			return;
		}

		this.tapFrames.set(mapped.key, mapped.hold ? TAP_FRAMES_DIRECTION : TAP_FRAMES_ACTION);
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	private fitLine(line: string, width: number, centered: boolean): string {
		if (width <= 0) return "";
		const clamped = visibleWidth(line) > width ? truncateToWidth(line, width, "…", false) : line;
		const len = visibleWidth(clamped);
		if (len >= width) return clamped;
		if (!centered) return clamped + " ".repeat(width - len);
		const leftPad = Math.floor((width - len) / 2);
		const rightPad = width - len - leftPad;
		return " ".repeat(leftPad) + clamped + " ".repeat(rightPad);
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const backend = getRenderBackend(this.options);
		const lines: string[] = [];
		const dim = (text: string) => `\x1b[2m${text}\x1b[22m`;
		const bold = (text: string) => `\x1b[1m${text}\x1b[22m`;
		const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;

		lines.push(
			this.fitLine(
				cyan(
					bold(
						`pi-boy • ←→↓/A D S • Z=B • X=A • Enter=Start • Tab=Select • M=audio • Q/Esc=quit+autosave • render:${backend}`,
					),
				),
				width,
				true,
			),
		);

		if (!this.screen) {
			lines.push(this.fitLine("loading...", width, false));
			this.cachedLines = lines;
			this.cachedWidth = width;
			this.cachedVersion = this.version;
			return lines;
		}

		const terminalRows = this.tui.terminal?.rows ?? 24;
		const availableRows = Math.max(6, terminalRows - 2 - (backend === "kitty" ? 0 : VIEWPORT_SAFETY_ROWS));

		if (backend === "kitty") {
			const image = this.kittyRenderer.render(this.screen, this.version, width, availableRows);
			if (image) {
				for (const line of image.lines) lines.push(line);
			} else {
				const ansiLines = renderAnsiFrame(this.screen, GB_WIDTH, GB_HEIGHT, this.options.ansiBlockMode, Math.min(width, ANSI_MAX_COLUMNS), Math.min(availableRows, ANSI_MAX_ROWS));
				for (const line of ansiLines) lines.push(this.fitLine(line, width, true));
			}
		} else {
			const ansiLines = renderAnsiFrame(
				this.screen,
				GB_WIDTH,
				GB_HEIGHT,
				this.options.ansiBlockMode,
				Math.min(width, ANSI_MAX_COLUMNS),
				Math.min(availableRows, ANSI_MAX_ROWS),
			);
			for (const line of ansiLines) lines.push(this.fitLine(line, width, true));
		}

		const holdMode = supportsHeldKeys(this.tui) ? "hold: enabled" : "hold: tap-mode";
		const renderInfo = backend === "ansi" ? `render: ansi • block:${this.options.ansiBlockMode}` : "render: kitty";
		lines.push(this.fitLine(dim(`${this.audioStatus} • ${this.stateStatus} • ${holdMode} • core:mgba • ${renderInfo}`), width, true));
		if (this.coreError) {
			lines.push(this.fitLine(`\x1b[31mcore error: ${this.coreError}\x1b[0m`, width, true));
		}

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;
		return lines;
	}

	dispose(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.kittyRenderer.dispose(this.tui);
		this.gb.dispose?.();
		this.audioOutput.close();
		if (this.previousClearOnShrink !== null) {
			this.tui.setClearOnShrink(this.previousClearOnShrink);
			this.previousClearOnShrink = null;
		}
	}
}
