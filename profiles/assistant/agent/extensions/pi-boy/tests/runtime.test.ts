import assert from "node:assert/strict";
import test from "node:test";
import { loadRuntimeOptions } from "../src/runtime.js";

test("loadRuntimeOptions parses supported environment flags", () => {
	const options = loadRuntimeOptions({
		PI_BOY_FORCE_ANSI: "yes",
		PI_BOY_FORCE_OVERLAY: "true",
		PI_BOY_AUDIO_BACKEND: "ffplay",
		PI_BOY_ANSI_BLOCK_MODE: "quarter",
		PI_BOY_ROM_PATH: "/tmp/test.gb",
	} as NodeJS.ProcessEnv);

	assert.deepEqual(options, {
		forceAnsi: true,
		forceOverlay: true,
		audioBackendPreference: "ffplay",
		ansiBlockMode: "quarter",
		romPathFromEnv: "/tmp/test.gb",
	});
});

test("loadRuntimeOptions falls back to safe defaults for invalid values", () => {
	const options = loadRuntimeOptions({
		PI_BOY_FORCE_ANSI: "nope",
		PI_BOY_FORCE_OVERLAY: "0",
		PI_BOY_AUDIO_BACKEND: "broken",
		PI_BOY_ANSI_BLOCK_MODE: "weird",
	} as NodeJS.ProcessEnv);

	assert.deepEqual(options, {
		forceAnsi: false,
		forceOverlay: false,
		audioBackendPreference: "auto",
		ansiBlockMode: "half",
		romPathFromEnv: undefined,
	});
});
