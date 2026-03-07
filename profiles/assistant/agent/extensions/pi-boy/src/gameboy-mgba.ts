import { MGBA_AUDIO_INPUT_SAMPLE_RATE } from "./constants.js";
import type { GameboyInstance, GameboyKey } from "./gameboy-types.js";
import { MgbaBridge } from "./mgba/bridge.js";
import { FRAMEBUFFER_BYTES, decodeFloat32Payload } from "./mgba/protocol.js";

class MgbaGameboy implements GameboyInstance {
	private readonly bridge = new MgbaBridge();
	private queuedKeys: GameboyKey[] = [];
	private screen: Buffer = Buffer.alloc(FRAMEBUFFER_BYTES, 0);
	private loadedRom: Buffer | null = null;

	private isRecoverableBridgeError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		const message = error.message.toLowerCase();
		return (
			message.includes("mgba bridge closed unexpectedly") ||
			message.includes("timed out reading from mgba bridge") ||
			message.includes("timed out writing to mgba bridge") ||
			message.includes("mgba bridge is not ready") ||
			message.includes("rom not loaded")
		);
	}

	private restoreBridgeWithLoadedRom(): void {
		if (!this.loadedRom) {
			throw new Error("mGBA bridge crashed before ROM was loaded");
		}
		this.bridge.reset();
		this.bridge.loadRom(this.loadedRom);
	}

	private runFrame(keyPayload: Buffer): Buffer {
		this.bridge.setKeys(keyPayload);
		const frame = this.bridge.doFrame();
		if (frame.length !== FRAMEBUFFER_BYTES) {
			throw new Error(`unexpected framebuffer size from mGBA bridge (${frame.length})`);
		}
		return frame;
	}

	loadRom(romData: Buffer): void {
		this.loadedRom = Buffer.from(romData);
		this.bridge.loadRom(this.loadedRom);
		this.queuedKeys = [];
		this.screen = Buffer.alloc(FRAMEBUFFER_BYTES, 0);
	}

	doFrame(): ArrayLike<number> {
		const keyPayload = Buffer.from(this.queuedKeys);
		this.queuedKeys = [];

		try {
			this.screen = this.runFrame(keyPayload);
			return this.screen;
		} catch (error) {
			if (!this.isRecoverableBridgeError(error) || !this.loadedRom) throw error;
			this.restoreBridgeWithLoadedRom();
			this.screen = this.runFrame(keyPayload);
			return this.screen;
		}
	}

	getAudio(): ArrayLike<number> | null | undefined {
		try {
			return decodeFloat32Payload(this.bridge.getAudioPayload());
		} catch (error) {
			if (this.isRecoverableBridgeError(error) && this.loadedRom) {
				this.restoreBridgeWithLoadedRom();
				return undefined;
			}
			throw error;
		}
	}

	getAudioSampleRate(): number {
		return MGBA_AUDIO_INPUT_SAMPLE_RATE;
	}

	saveState(): Buffer {
		if (!this.loadedRom) {
			throw new Error("cannot save state before ROM is loaded");
		}
		try {
			return Buffer.from(this.bridge.saveState());
		} catch (error) {
			if (!this.isRecoverableBridgeError(error) || !this.loadedRom) throw error;
			this.restoreBridgeWithLoadedRom();
			return Buffer.from(this.bridge.saveState());
		}
	}

	loadState(state: Buffer): void {
		if (!this.loadedRom) {
			throw new Error("cannot load state before ROM is loaded");
		}
		try {
			this.bridge.loadState(state);
			this.queuedKeys = [];
			this.screen = this.gbScreenSnapshot();
		} catch (error) {
			if (!this.isRecoverableBridgeError(error) || !this.loadedRom) throw error;
			this.restoreBridgeWithLoadedRom();
			this.bridge.loadState(state);
			this.queuedKeys = [];
			this.screen = this.gbScreenSnapshot();
		}
	}

	private gbScreenSnapshot(): Buffer {
		const snapshot = this.bridge.doFrame();
		if (snapshot.length !== FRAMEBUFFER_BYTES) {
			throw new Error(`unexpected framebuffer size from mGBA bridge (${snapshot.length})`);
		}
		return snapshot;
	}

	getScreen(): ArrayLike<number> {
		return this.screen;
	}

	pressKeys(keys: GameboyKey[]): void {
		this.queuedKeys = keys.length === 0 ? [] : [...keys];
	}

	dispose(): void {
		this.loadedRom = null;
		this.bridge.dispose();
	}
}

export function createMgbaGameboy(): GameboyInstance {
	return new MgbaGameboy();
}
