import assert from "node:assert/strict";
import test from "node:test";
import { AudioOutput } from "../src/audio-output.js";
import { AUDIO_OUTPUT_SAMPLE_RATE, MGBA_AUDIO_INPUT_SAMPLE_RATE } from "../src/constants.js";

test("writeSamples resamples mGBA stereo floats to output PCM", () => {
	const output = new AudioOutput("auto") as any;
	const writes: Buffer[] = [];

	output.initialized = true;
	output.backend = "speaker";
	output.speaker = {
		write(buffer: Buffer) {
			writes.push(Buffer.from(buffer));
			return true;
		},
		end() {},
	};

	const stereoFrames = 32768;
	const samples = new Float32Array(stereoFrames * 2);
	for (let i = 0; i < stereoFrames; i++) {
		samples[i * 2] = i % 2 === 0 ? 0.75 : -0.25;
		samples[i * 2 + 1] = i % 4 < 2 ? -0.5 : 0.25;
	}

	assert.equal(output.writeSamples(samples), true);
	assert.equal(writes.length, 1);

	const expectedFrames = Math.floor((stereoFrames * AUDIO_OUTPUT_SAMPLE_RATE) / MGBA_AUDIO_INPUT_SAMPLE_RATE);
	assert.equal(writes[0].length, expectedFrames * 4);

	let sawNonZeroPcm = false;
	for (let offset = 0; offset < writes[0].length; offset += 2) {
		if (writes[0].readInt16LE(offset) !== 0) {
			sawNonZeroPcm = true;
			break;
		}
	}
	assert.equal(sawNonZeroPcm, true);
});

test("writeSamples fails fast on invalid input sample rate", () => {
	const output = new AudioOutput("auto") as any;
	output.initialized = true;
	output.backend = "speaker";
	output.speaker = {
		write() {
			throw new Error("should not write");
		},
		end() {},
	};

	assert.equal(output.writeSamples(new Float32Array([0.25, -0.25]), 0), false);
});
