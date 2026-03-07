import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { CommandContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { AudioOutput } from "./audio-output.js";
import { type PiBoyConfig, loadConfig, pickRomPath, resolveInputPath, resolveRomPath, saveConfig } from "./config.js";
import { runSelfTest } from "./gameboy.js";
import { notify } from "./notify.js";
import { PiBoyComponent, type PiBoyExitResult } from "./pi-boy-component.js";
import { type RuntimeOptions, loadRuntimeOptions } from "./runtime.js";
import { getRomPathCompletions, isRomFilePath, listRomFiles } from "./roms.js";
import {
	getSaveStatePath,
	listSaveStates,
	loadSaveState,
	removeSaveState,
	removeSaveStateByPath,
	writeSaveState,
} from "./save-state.js";

const envRuntimeOptions = loadRuntimeOptions();
const envOverrides = {
	forceAnsi: process.env.PI_BOY_FORCE_ANSI !== undefined,
	forceOverlay: process.env.PI_BOY_FORCE_OVERLAY !== undefined,
	audioBackendPreference: process.env.PI_BOY_AUDIO_BACKEND !== undefined,
	ansiBlockMode: process.env.PI_BOY_ANSI_BLOCK_MODE !== undefined,
};
const MAX_ROM_SELECTION_ITEMS = 250;

type ReadRomOptions = {
	notifyErrors?: boolean;
};

type ReadRomResult = {
	rom: Buffer;
	romPath: string;
};

type SettingsAction =
	| "set_rom_directory"
	| "set_rom"
	| "set_audio_backend"
	| "set_render_backend"
	| "set_ansi_block_mode"
	| "set_overlay_mode"
	| "run_self_test"
	| "clear_rom"
	| "reset_settings"
	| "done";

function formatSizeBytes(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0B";
	if (value < 1024) return `${Math.round(value)}B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
	return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function formatModifiedTime(modifiedMs: number): string {
	if (!Number.isFinite(modifiedMs) || modifiedMs <= 0) return "unknown";
	return new Date(modifiedMs).toLocaleString();
}

function getConfiguredRomPath(config: PiBoyConfig, cwd: string, runtimeOptions: RuntimeOptions): string | undefined {
	return pickRomPath("", config, cwd, runtimeOptions.romPathFromEnv);
}

function getClearSuspendUsageMessage(): string {
	return "Usage: /pi-boy:clear_suspend [path-to-rom]";
}

function getEffectiveRuntimeOptions(config: PiBoyConfig): RuntimeOptions {
	return {
		forceAnsi: envOverrides.forceAnsi ? envRuntimeOptions.forceAnsi : config.forceAnsi === true,
		forceOverlay: envOverrides.forceOverlay ? envRuntimeOptions.forceOverlay : config.forceOverlay === true,
		audioBackendPreference: envOverrides.audioBackendPreference
			? envRuntimeOptions.audioBackendPreference
			: config.audioBackendPreference ?? "auto",
		ansiBlockMode: envOverrides.ansiBlockMode ? envRuntimeOptions.ansiBlockMode : config.ansiBlockMode ?? "half",
		romPathFromEnv: envRuntimeOptions.romPathFromEnv,
	};
}

function validateRomPath(romPath: string): string | null {
	if (!existsSync(romPath)) {
		return `ROM not found: ${romPath}`;
	}

	try {
		if (!statSync(romPath).isFile()) {
			return `ROM is not a file: ${romPath}`;
		}
	} catch (error) {
		return `Unable to read ROM path: ${error instanceof Error ? error.message : String(error)}`;
	}

	if (!isRomFilePath(romPath)) {
		return `Unsupported ROM type: ${romPath}. Expected a .gb or .gbc file.`;
	}

	return null;
}

function validateDirectoryPath(directoryPath: string): string | null {
	if (!existsSync(directoryPath)) {
		return `Directory not found: ${directoryPath}`;
	}
	try {
		if (!statSync(directoryPath).isDirectory()) {
			return `Path is not a directory: ${directoryPath}`;
		}
	} catch (error) {
		return `Unable to read directory: ${error instanceof Error ? error.message : String(error)}`;
	}
	return null;
}

function resolveConfiguredRomDirectory(config: PiBoyConfig, cwd: string): string | undefined {
	if (!config.romDirectory) return undefined;
	return resolveInputPath(config.romDirectory, cwd);
}

async function promptForRomPath(ctx: CommandContext, config: PiBoyConfig, runtimeOptions: RuntimeOptions): Promise<string | undefined> {
	if (!ctx.hasUI) return undefined;
	const romInput = await ctx.ui.input(
		"ROM path (.gb/.gbc). Tip: /pi-boy:load_rom <path> supports autocomplete.",
		config.romPath ?? runtimeOptions.romPathFromEnv ?? "",
	);
	if (!romInput) return undefined;
	return resolveRomPath(romInput, ctx.cwd, config.romDirectory);
}

async function chooseRomPathInteractive(
	ctx: CommandContext,
	config: PiBoyConfig,
	runtimeOptions: RuntimeOptions,
): Promise<string | undefined> {
	const romDirectory = resolveConfiguredRomDirectory(config, ctx.cwd);
	if (romDirectory) {
		const directoryError = validateDirectoryPath(romDirectory);
		if (!directoryError) {
			const romFiles = listRomFiles(romDirectory, MAX_ROM_SELECTION_ITEMS + 1);
			if (romFiles.length > 0) {
				const showLimit = Math.min(MAX_ROM_SELECTION_ITEMS, romFiles.length);
				const shownRomFiles = romFiles.slice(0, showLimit);
				const labels = shownRomFiles.map((romPath) => relative(romDirectory, romPath));
				const selected = await ctx.ui.select(
					romFiles.length > showLimit
						? `Select ROM from ${romDirectory} (showing first ${showLimit})`
						: `Select ROM from ${romDirectory}`,
					[...labels, "Type full path…"],
				);
				if (!selected) return undefined;
				if (selected !== "Type full path…") {
					const selectedIndex = labels.indexOf(selected);
					if (selectedIndex >= 0) return shownRomFiles[selectedIndex];
				}
			} else {
				notify(ctx, `No .gb/.gbc ROMs found in ${romDirectory}.`, "warning");
			}
		} else {
			notify(ctx, directoryError, "warning");
		}
	}

	return promptForRomPath(ctx, config, runtimeOptions);
}

function saveSelectedRom(config: PiBoyConfig, romPath: string): void {
	const nextConfig: PiBoyConfig = { ...config, romPath };
	if (!nextConfig.romDirectory) {
		nextConfig.romDirectory = dirname(romPath);
	}
	saveConfig(nextConfig);
}

async function readConfiguredRom(
	args: string,
	ctx: CommandContext,
	options: ReadRomOptions = {},
): Promise<ReadRomResult | null> {
	const notifyErrors = options.notifyErrors ?? true;
	const config = loadConfig();
	const runtimeOptions = getEffectiveRuntimeOptions(config);
	const romPath = pickRomPath(args, config, ctx.cwd, runtimeOptions.romPathFromEnv);
	if (!romPath) {
		if (notifyErrors) {
			notify(ctx, "No ROM configured. Use /pi-boy:settings or /pi-boy:load_rom first.", "error");
		}
		return null;
	}

	const romPathError = validateRomPath(romPath);
	if (romPathError) {
		if (notifyErrors) {
			notify(ctx, romPathError, "error");
		}
		return null;
	}

	try {
		return { rom: readFileSync(romPath), romPath };
	} catch (error) {
		if (notifyErrors) {
			notify(ctx, `Failed to read ROM: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
		return null;
	}
}

async function runPiBoySelfTest(args: string, ctx: CommandContext): Promise<void> {
	let hasFailure = false;
	let romSummary = "";
	let audioSummary = "";

	const romResult = await readConfiguredRom(args, ctx, { notifyErrors: false });
	if (!romResult) {
		hasFailure = true;
		romSummary = "ROM/core smoke test failed: no readable ROM configured.";
	} else {
		const error = runSelfTest(romResult.rom);
		if (error) {
			hasFailure = true;
			romSummary = `ROM/core smoke test failed: ${error}.`;
		} else {
			romSummary = `ROM/core smoke test passed (mgba): ${romResult.romPath}.`;
		}
	}

	const config = loadConfig();
	const runtimeOptions = getEffectiveRuntimeOptions(config);
	const audio = new AudioOutput(runtimeOptions.audioBackendPreference);
	try {
		await audio.init();
		audioSummary = `Audio backend ready: ${audio.getBackendLabel()}.`;
	} catch (error) {
		hasFailure = true;
		audioSummary = `Audio backend unavailable: ${error instanceof Error ? error.message : String(error)}.`;
	} finally {
		audio.close();
	}

	notify(
		ctx,
		`pi-boy self-test ${hasFailure ? "failed" : "passed"}.\n- ${romSummary}\n- ${audioSummary}`,
		hasFailure ? "error" : "info",
	);
}

function buildSettingsItems(config: PiBoyConfig, runtimeOptions: RuntimeOptions, cwd: string): Array<{ action: SettingsAction; label: string }> {
	const romDirectory = resolveConfiguredRomDirectory(config, cwd) ?? "(not set)";
	const selectedRom = pickRomPath("", config, cwd, runtimeOptions.romPathFromEnv) ?? "(not set)";
	const renderer = runtimeOptions.forceAnsi ? "ansi" : "auto (kitty when available)";
	const overlayMode = runtimeOptions.forceOverlay ? "overlay" : "inline";

	const renderLabel = envOverrides.forceAnsi ? `${renderer} (PI_BOY_FORCE_ANSI)` : renderer;
	const overlayLabel = envOverrides.forceOverlay ? `${overlayMode} (PI_BOY_FORCE_OVERLAY)` : overlayMode;
	const audioLabel = envOverrides.audioBackendPreference
		? `${runtimeOptions.audioBackendPreference} (PI_BOY_AUDIO_BACKEND)`
		: runtimeOptions.audioBackendPreference;
	const ansiBlockLabel = envOverrides.ansiBlockMode
		? `${runtimeOptions.ansiBlockMode} (PI_BOY_ANSI_BLOCK_MODE)`
		: runtimeOptions.ansiBlockMode;

	return [
		{ action: "set_rom_directory", label: `1) ROM directory: ${romDirectory}` },
		{ action: "set_rom", label: `2) Selected ROM: ${selectedRom}` },
		{ action: "set_audio_backend", label: `3) Audio backend: ${audioLabel}` },
		{ action: "set_render_backend", label: `4) Render mode: ${renderLabel}` },
		{ action: "set_ansi_block_mode", label: `5) ANSI block mode: ${ansiBlockLabel}` },
		{ action: "set_overlay_mode", label: `6) Overlay mode: ${overlayLabel}` },
		{ action: "run_self_test", label: "7) Run self-test" },
		{ action: "clear_rom", label: "8) Clear selected ROM" },
		{ action: "reset_settings", label: "9) Reset all settings" },
		{ action: "done", label: "0) Done" },
	];
}

async function handleSettingsAction(action: SettingsAction, ctx: CommandContext): Promise<boolean> {
	const config = loadConfig();
	const runtimeOptions = getEffectiveRuntimeOptions(config);

	switch (action) {
		case "set_rom_directory": {
			const fallbackDirectory =
				config.romPath?.trim().length
					? dirname(resolveRomPath(config.romPath, ctx.cwd, config.romDirectory))
					: "";
			const romDirectoryInput = await ctx.ui.input(
				"ROM directory (leave empty to clear)",
				config.romDirectory ?? fallbackDirectory,
			);
			if (romDirectoryInput === undefined) return true;
			if (romDirectoryInput.trim().length === 0) {
				const { romDirectory: _ignored, ...nextConfig } = config;
				saveConfig(nextConfig);
				notify(ctx, "ROM directory cleared.", "info");
				return true;
			}

			const romDirectory = resolveInputPath(romDirectoryInput, ctx.cwd);
			const directoryError = validateDirectoryPath(romDirectory);
			if (directoryError) {
				notify(ctx, directoryError, "error");
				return true;
			}
			saveConfig({ ...config, romDirectory });
			notify(ctx, `ROM directory saved: ${romDirectory}`, "info");
			return true;
		}

		case "set_rom": {
			const romPath = await chooseRomPathInteractive(ctx, config, runtimeOptions);
			if (!romPath) {
				notify(ctx, "Load ROM cancelled.", "info");
				return true;
			}
			const romPathError = validateRomPath(romPath);
			if (romPathError) {
				notify(ctx, romPathError, "error");
				return true;
			}
			saveSelectedRom(config, romPath);
			notify(ctx, `ROM saved: ${romPath}`, "info");
			return true;
		}

		case "set_audio_backend": {
			const selected = await ctx.ui.select("Audio backend", ["auto", "speaker", "ffplay"]);
			if (!selected) return true;
			if (selected !== "auto" && selected !== "speaker" && selected !== "ffplay") return true;
			saveConfig({ ...config, audioBackendPreference: selected });
			notify(ctx, `Audio backend set to ${selected}.`, "info");
			return true;
		}

		case "set_render_backend": {
			const selected = await ctx.ui.select("Render mode", ["auto (kitty when available)", "ansi"]);
			if (!selected) return true;
			saveConfig({ ...config, forceAnsi: selected === "ansi" });
			notify(ctx, `Render mode set to ${selected}.`, "info");
			return true;
		}

		case "set_ansi_block_mode": {
			const selected = await ctx.ui.select("ANSI block mode", ["half", "quarter"]);
			if (!selected) return true;
			if (selected !== "half" && selected !== "quarter") return true;
			saveConfig({ ...config, ansiBlockMode: selected });
			notify(ctx, `ANSI block mode set to ${selected}.`, "info");
			return true;
		}

		case "set_overlay_mode": {
			const selected = await ctx.ui.select("Overlay mode", ["inline", "overlay"]);
			if (!selected) return true;
			saveConfig({ ...config, forceOverlay: selected === "overlay" });
			notify(ctx, `Overlay mode set to ${selected}.`, "info");
			return true;
		}

		case "run_self_test": {
			await runPiBoySelfTest("", ctx);
			return true;
		}

		case "clear_rom": {
			if (!config.romPath) {
				notify(ctx, "No ROM is currently saved in config.", "info");
				return true;
			}
			const confirmed = await ctx.ui.confirm("Clear selected ROM?", "This removes the saved ROM path from config.");
			if (!confirmed) return true;
			const { romPath: _ignored, ...nextConfig } = config;
			saveConfig(nextConfig);
			notify(ctx, "Saved ROM path cleared.", "info");
			return true;
		}

		case "reset_settings": {
			const confirmed = await ctx.ui.confirm(
				"Reset pi-boy settings?",
				"This clears ROM path, ROM directory, and all pi-boy runtime preferences.",
			);
			if (!confirmed) return true;
			saveConfig({});
			notify(ctx, "pi-boy settings reset.", "info");
			return true;
		}

		case "done":
		default:
			return false;
	}
}

async function openSettingsMenu(ctx: CommandContext): Promise<void> {
	if (!ctx.hasUI) {
		notify(ctx, "pi-boy:settings requires interactive mode.", "error");
		return;
	}

	while (true) {
		const config = loadConfig();
		const runtimeOptions = getEffectiveRuntimeOptions(config);
		const items = buildSettingsItems(config, runtimeOptions, ctx.cwd);
		const selectedLabel = await ctx.ui.select("pi-boy settings", items.map((item) => item.label));
		if (!selectedLabel) return;
		const selected = items.find((item) => item.label === selectedLabel);
		if (!selected) return;
		const shouldContinue = await handleSettingsAction(selected.action, ctx);
		if (!shouldContinue) return;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		notify(ctx, "pi-boy loaded (core: mgba). Use /pi-boy:settings, then /pi-boy:start.", "info");
	});

	pi.registerCommand("pi-boy:settings", {
		description: "Configure pi-boy settings (ROM directory, render/audio options, self-test)",
		handler: async (_args, ctx) => {
			await openSettingsMenu(ctx);
		},
	});

	pi.registerCommand("pi-boy:load_rom", {
		description: "Select a ROM from your ROM directory or set it by path",
		getArgumentCompletions: (argumentPrefix) => {
			const config = loadConfig();
			return getRomPathCompletions(argumentPrefix, process.cwd(), config.romDirectory);
		},
		handler: async (args, ctx) => {
			const config = loadConfig();
			const runtimeOptions = getEffectiveRuntimeOptions(config);
			const trimmed = args.trim();

			let romPath: string | undefined;
			if (trimmed.length > 0) {
				romPath = resolveRomPath(trimmed, ctx.cwd, config.romDirectory);
			} else if (ctx.hasUI) {
				romPath = await chooseRomPathInteractive(ctx, config, runtimeOptions);
				if (!romPath) {
					notify(ctx, "Load ROM cancelled.", "info");
					return;
				}
			} else {
				notify(ctx, "Usage: /pi-boy:load_rom /absolute/path/to/game.gb", "error");
				return;
			}

			const romPathError = validateRomPath(romPath);
			if (romPathError) {
				notify(ctx, romPathError, "error");
				return;
			}

			saveSelectedRom(config, romPath);
			notify(ctx, `ROM path saved: ${romPath}`, "info");
		},
	});

	pi.registerCommand("pi-boy:clear_suspend", {
		description: "Delete suspend state (shows a picker when no ROM path is provided)",
		getArgumentCompletions: (argumentPrefix) => {
			const config = loadConfig();
			return getRomPathCompletions(argumentPrefix, process.cwd(), config.romDirectory);
		},
		handler: async (args, ctx) => {
			const config = loadConfig();
			const runtimeOptions = getEffectiveRuntimeOptions(config);
			const trimmed = args.trim();

			if (trimmed.length === 0 && ctx.hasUI) {
				const states = listSaveStates();
				if (states.length === 0) {
					notify(ctx, "No suspend states found.", "info");
					return;
				}

				const currentRomPath = getConfiguredRomPath(config, ctx.cwd, runtimeOptions);
				const currentStatePath = currentRomPath ? getSaveStatePath(currentRomPath) : undefined;
				const options = states.map((state, index) => {
					const currentMarker = currentStatePath === state.path ? " • current ROM" : "";
					return `${index + 1}) ${state.name} • ${formatSizeBytes(state.sizeBytes)} • ${formatModifiedTime(state.modifiedMs)}${currentMarker}`;
				});

				const selectedOption = await ctx.ui.select("Delete suspend state", options);
				if (!selectedOption) {
					notify(ctx, "Suspend state deletion cancelled.", "info");
					return;
				}

				const selectedIndex = options.indexOf(selectedOption);
				const selectedState = selectedIndex >= 0 ? states[selectedIndex] : undefined;
				if (!selectedState) {
					notify(ctx, "Failed to resolve selected suspend state.", "error");
					return;
				}

				const confirmed = await ctx.ui.confirm(
					"Delete suspend state?",
					`State file: ${selectedState.name}\nModified: ${formatModifiedTime(selectedState.modifiedMs)}\nSize: ${formatSizeBytes(selectedState.sizeBytes)}`,
				);
				if (!confirmed) {
					notify(ctx, "Suspend state deletion cancelled.", "info");
					return;
				}

				const deleted = removeSaveStateByPath(selectedState.path);
				if (!deleted) {
					notify(ctx, `Failed to delete suspend state: ${selectedState.name}`, "warning");
					return;
				}

				notify(ctx, `Suspend state deleted: ${selectedState.name}`, "info");
				return;
			}

			const romPath =
				trimmed.length > 0
					? resolveRomPath(trimmed, ctx.cwd, config.romDirectory)
					: getConfiguredRomPath(config, ctx.cwd, runtimeOptions);

			if (!romPath) {
				notify(ctx, `No ROM selected. ${getClearSuspendUsageMessage()}`, "error");
				return;
			}

			const statePath = getSaveStatePath(romPath);
			if (!existsSync(statePath)) {
				notify(ctx, `No suspend state found for ROM: ${romPath}`, "info");
				return;
			}

			if (ctx.hasUI) {
				const confirmed = await ctx.ui.confirm(
					"Delete suspend state?",
					`ROM: ${romPath}\nState file: ${statePath}`,
				);
				if (!confirmed) {
					notify(ctx, "Suspend state deletion cancelled.", "info");
					return;
				}
			}

			const deleted = removeSaveState(romPath);
			if (!deleted && existsSync(statePath)) {
				notify(ctx, `Failed to delete suspend state: ${statePath}`, "warning");
				return;
			}

			notify(ctx, `Suspend state deleted for ROM: ${romPath}`, "info");
		},
	});

	pi.registerCommand("pi-boy:start", {
		description: "Start pi-boy with the configured ROM",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				notify(ctx, "pi-boy requires interactive mode.", "error");
				return;
			}

			const romResult = await readConfiguredRom(args, ctx);
			if (!romResult) return;

			const config = loadConfig();
			const runtimeOptions = getEffectiveRuntimeOptions(config);
			const resumeState = loadSaveState(romResult.romPath);
			if (resumeState) {
				notify(ctx, "pi-boy: found suspended state, attempting resume.", "info");
			}

			if (!runtimeOptions.forceOverlay) {
				notify(ctx, "pi-boy: inline mode enabled.", "info");
			}

			try {
				const exitResult = await ctx.ui.custom<PiBoyExitResult | undefined>(
					(tui, _theme, _keybindings, done) =>
						new PiBoyComponent(tui, romResult.rom, (result) => done(result), runtimeOptions, resumeState ?? undefined),
					runtimeOptions.forceOverlay
						? {
								overlay: true,
								overlayOptions: {
									width: "100%",
									maxHeight: "100%",
									anchor: "center",
									margin: 0,
								},
						  }
						: undefined,
				);

				if (exitResult?.suspendState && exitResult.suspendState.length > 0) {
					writeSaveState(romResult.romPath, exitResult.suspendState);
					notify(ctx, "pi-boy: progress suspended. Run /pi-boy:start to resume.", "info");
				} else if (exitResult?.suspendError) {
					notify(ctx, `pi-boy: failed to save suspend state (${exitResult.suspendError}).`, "warning");
				}
			} catch (error) {
				notify(ctx, `pi-boy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
