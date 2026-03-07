import assert from "node:assert/strict";
import test from "node:test";
import { decodeFloat32Payload } from "../src/mgba/protocol.js";

test("decodeFloat32Payload decodes little-endian float32 samples", () => {
	const payload = Buffer.alloc(12);
	payload.writeFloatLE(0.25, 0);
	payload.writeFloatLE(-0.5, 4);
	payload.writeFloatLE(1, 8);

	const decoded = decodeFloat32Payload(payload);
	assert.deepEqual(Array.from(decoded), [0.25, -0.5, 1]);
});

test("decodeFloat32Payload rejects invalid payload sizes", () => {
	assert.throws(() => decodeFloat32Payload(Buffer.from([1, 2, 3])), /unexpected audio payload size/);
});
