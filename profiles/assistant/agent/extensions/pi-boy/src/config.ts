import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { AnsiBlockMode, AudioBackendPreference } from "./runtime.js";
import { CONFIG_PATH } from "./constants.js";

export interface PiBoyConfig {
	romPath?: string;
	romDirectory?: string;
	forceAnsi?: boolean;
	forceOverlay?: boolean;
	audioBackendPreference?: AudioBackendPreference;
	ansiBlockMode?: AnsiBlockMode;
}

function stripWrappingQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function expandHome(inputPath: string): string {
	if (inputPath === "~") return homedir();
	if (inputPath.startsWith("~/")) return join(homedir(), inputPath.slice(2));
	return inputPath;
}

function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function asAudioBackendPreference(value: unknown): AudioBackendPreference | undefined {
	if (value === "auto" || value === "speaker" || value === "ffplay") return value;
	return undefined;
}

function asAnsiBlockMode(value: unknown): AnsiBlockMode | undefined {
	if (value === "half" || value === "quarter") return value;
	return undefined;
}

function hasExplicitRelativePrefix(inputPath: string): boolean {
	return inputPath === "." || inputPath === ".." || inputPath.startsWith("./") || inputPath.startsWith("../");
}

export function resolveInputPath(inputPath: string, cwd: string): string {
	const expanded = expandHome(stripWrappingQuotes(inputPath));
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export function resolveRomPath(inputPath: string, cwd: string, romDirectory?: string): string {
	const stripped = stripWrappingQuotes(inputPath).trim();
	if (stripped.length === 0) return "";

	const expanded = expandHome(stripped);
	if (isAbsolute(expanded)) return expanded;

	if (romDirectory && !hasExplicitRelativePrefix(expanded)) {
		const romRoot = resolveInputPath(romDirectory, cwd);
		return resolve(romRoot, expanded);
	}

	return resolve(cwd, expanded);
}

export function loadConfig(): PiBoyConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
		const raw = typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};

		return {
			romPath: asNonEmptyString(raw.romPath),
			romDirectory: asNonEmptyString(raw.romDirectory),
			forceAnsi: asBoolean(raw.forceAnsi),
			forceOverlay: asBoolean(raw.forceOverlay),
			audioBackendPreference: asAudioBackendPreference(raw.audioBackendPreference),
			ansiBlockMode: asAnsiBlockMode(raw.ansiBlockMode),
		};
	} catch {
		return {};
	}
}

export function saveConfig(config: PiBoyConfig): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function pickRomPath(args: string, config: PiBoyConfig, cwd: string, envRomPath?: string): string | undefined {
	const argPath = stripWrappingQuotes(args.trim());
	if (argPath.length > 0) return resolveRomPath(argPath, cwd, config.romDirectory);

	if (envRomPath && envRomPath.trim().length > 0) {
		return resolveRomPath(envRomPath, cwd, config.romDirectory);
	}

	if (config.romPath && config.romPath.trim().length > 0) {
		return resolveRomPath(config.romPath, cwd, config.romDirectory);
	}

	return undefined;
}
