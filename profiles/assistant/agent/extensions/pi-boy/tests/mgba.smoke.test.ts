import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { MGBA_AUDIO_INPUT_SAMPLE_RATE } from "../src/constants.js";
import { createGameboy, KEYMAP, runSelfTest } from "../src/gameboy.js";

const romPath = process.env.PI_BOY_TEST_ROM;

test(
	"mGBA smoke test with a real ROM",
	{ skip: !romPath && "set PI_BOY_TEST_ROM=/absolute/path/to/game.gb to run the smoke test" },
	() => {
		assert.ok(romPath);
		assert.equal(existsSync(romPath), true, `ROM not found: ${romPath}`);

		const rom = readFileSync(romPath);
		assert.equal(runSelfTest(rom), null);

		const gb = createGameboy();
		try {
			gb.loadRom(rom);
			for (let i = 0; i < 240; i++) {
				if (i === 60) gb.pressKeys([KEYMAP.START]);
				gb.doFrame();
			}

			const screen = gb.getScreen();
			const audio = gb.getAudio();
			assert.equal(screen.length, 160 * 144 * 4);
			assert.equal(gb.getAudioSampleRate(), MGBA_AUDIO_INPUT_SAMPLE_RATE);
			assert.ok(audio.length > 0, "expected mGBA to produce an audio payload");
		} finally {
			gb.dispose?.();
		}
	},
);
