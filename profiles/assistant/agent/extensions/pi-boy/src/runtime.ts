export type RenderBackend = "kitty" | "ansi";
export type AnsiBlockMode = "half" | "quarter";
export type AudioBackendPreference = "auto" | "speaker" | "ffplay";

export interface RuntimeOptions {
	forceAnsi: boolean;
	forceOverlay: boolean;
	audioBackendPreference: AudioBackendPreference;
	ansiBlockMode: AnsiBlockMode;
	romPathFromEnv?: string;
}

function isTruthy(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseAudioBackendPreference(value: string | undefined): AudioBackendPreference {
	if (value === "speaker" || value === "ffplay") return value;
	return "auto";
}

function parseAnsiBlockMode(value: string | undefined): AnsiBlockMode {
	return value?.trim().toLowerCase() === "quarter" ? "quarter" : "half";
}

export function loadRuntimeOptions(env: NodeJS.ProcessEnv = process.env): RuntimeOptions {
	return {
		forceAnsi: isTruthy(env.PI_BOY_FORCE_ANSI),
		forceOverlay: isTruthy(env.PI_BOY_FORCE_OVERLAY),
		audioBackendPreference: parseAudioBackendPreference(env.PI_BOY_AUDIO_BACKEND),
		ansiBlockMode: parseAnsiBlockMode(env.PI_BOY_ANSI_BLOCK_MODE),
		romPathFromEnv: env.PI_BOY_ROM_PATH,
	};
}
