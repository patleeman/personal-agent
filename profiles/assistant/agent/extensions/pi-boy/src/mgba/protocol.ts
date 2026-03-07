import { GB_HEIGHT, GB_WIDTH } from "../constants.js";

export const CMD_LOAD_ROM = 1;
export const CMD_SET_KEYS = 2;
export const CMD_DO_FRAME = 3;
export const CMD_SHUTDOWN = 4;
export const CMD_GET_AUDIO = 5;
export const CMD_SAVE_STATE = 6;
export const CMD_LOAD_STATE = 7;

export const STATUS_OK = 0;
export const HEADER_BYTES = 5;
export const FRAMEBUFFER_BYTES = GB_WIDTH * GB_HEIGHT * 4;
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
export const STDERR_BUFFER_LIMIT = 8_192;

export function decodeFloat32Payload(payload: Buffer): Float32Array {
	if (payload.length === 0) return new Float32Array(0);
	if (payload.length % 4 !== 0) {
		throw new Error(`unexpected audio payload size from mGBA bridge (${payload.length})`);
	}

	const count = payload.length / 4;
	const out = new Float32Array(count);
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
	for (let i = 0; i < count; i++) {
		out[i] = view.getFloat32(i * 4, true);
	}
	return out;
}
