import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
	AUDIO_DC_ALPHA,
	AUDIO_GAIN,
	AUDIO_LOW_PASS_ALPHA,
	AUDIO_MAX_QUEUE_BYTES,
	AUDIO_OUTPUT_SAMPLE_RATE,
	AUDIO_PRIME_CHUNKS,
	AUDIO_PRIME_FRAMES,
	AUDIO_SPEAKER_HIGH_WATER_MARK,
	AUDIO_SPEAKER_SAMPLES_PER_FRAME,
	FFPLAY_CANDIDATES,
	MGBA_AUDIO_INPUT_SAMPLE_RATE,
} from "./constants.js";
import type { AudioBackendPreference } from "./runtime.js";

export type AudioBackendLabel = "speaker" | "ffplay" | "none";

type SpeakerHandle = {
	write: (buffer: Buffer) => boolean;
	end: () => void;
	on?: (event: string, listener: () => void) => void;
	writableNeedDrain?: boolean;
	writableLength?: number;
	destroyed?: boolean;
};

export class AudioOutput {
	private speaker: SpeakerHandle | null = null;
	private ffplay: ChildProcessWithoutNullStreams | null = null;
	private backend: AudioBackendLabel = "none";
	private initialized = false;
	private dcLeft = -1;
	private dcRight = -1;
	private filteredLeft = 0;
	private filteredRight = 0;
	private resampleCarry = 0;
	private dropUntilDrain = false;

	constructor(private readonly preference: AudioBackendPreference) {}

	private async initSpeakerBackend(): Promise<void> {
		const speakerCandidates = ["@mastra/node-speaker", "speaker"];
		let lastError = "no speaker module available";

		for (const moduleName of speakerCandidates) {
			try {
				const speakerModule = await import(moduleName);
				const SpeakerCtor =
					(speakerModule as { default?: new (options: object) => SpeakerHandle }).default ??
					(speakerModule as unknown as new (options: object) => SpeakerHandle);

				this.speaker = new SpeakerCtor({
					channels: 2,
					bitDepth: 16,
					sampleRate: AUDIO_OUTPUT_SAMPLE_RATE,
					signed: true,
					float: false,
					samplesPerFrame: AUDIO_SPEAKER_SAMPLES_PER_FRAME,
					highWaterMark: AUDIO_SPEAKER_HIGH_WATER_MARK,
				});

				this.speaker.on?.("drain", () => {
					this.dropUntilDrain = false;
				});

				const silence = Buffer.alloc(AUDIO_PRIME_FRAMES * 4, 0);
				for (let i = 0; i < AUDIO_PRIME_CHUNKS; i++) {
					this.speaker.write(silence);
				}

				this.backend = "speaker";
				this.initialized = true;
				this.dropUntilDrain = false;
				return;
			} catch (error) {
				lastError = `${moduleName}: ${error instanceof Error ? error.message : String(error)}`;
				this.speaker = null;
			}
		}

		throw new Error(lastError);
	}

	private async spawnFfplay(executable: string): Promise<ChildProcessWithoutNullStreams> {
		const ffplay = spawn(
			executable,
			[
				"-nodisp",
				"-autoexit",
				"-loglevel",
				"error",
				"-fflags",
				"nobuffer",
				"-flags",
				"low_delay",
				"-analyzeduration",
				"0",
				"-probesize",
				"32",
				"-f",
				"s16le",
				"-sample_rate",
				String(AUDIO_OUTPUT_SAMPLE_RATE),
				"-ch_layout",
				"stereo",
				"-i",
				"pipe:0",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);

		ffplay.stdout.resume();
		ffplay.stderr.resume();
		ffplay.unref();

		await new Promise<void>((resolve, reject) => {
			const onSpawn = () => {
				cleanup();
				resolve();
			};
			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};
			const cleanup = () => {
				ffplay.off("spawn", onSpawn);
				ffplay.off("error", onError);
			};
			ffplay.once("spawn", onSpawn);
			ffplay.once("error", onError);
		});

		return ffplay;
	}

	private async initFfplayBackend(): Promise<void> {
		let ffplay: ChildProcessWithoutNullStreams | null = null;
		let lastError = "ffplay not available";

		for (const candidate of FFPLAY_CANDIDATES) {
			try {
				ffplay = await this.spawnFfplay(candidate);
				break;
			} catch (error) {
				lastError = `${candidate}: ${error instanceof Error ? error.message : String(error)}`;
			}
		}

		if (!ffplay) throw new Error(lastError);

		ffplay.stdin.on("error", () => {
			if (this.ffplay === ffplay) {
				this.close();
			}
		});
		ffplay.stdin.on("drain", () => {
			if (this.ffplay === ffplay) {
				this.dropUntilDrain = false;
			}
		});
		ffplay.on("close", () => {
			if (this.ffplay === ffplay) {
				this.ffplay = null;
				this.backend = "none";
				this.initialized = false;
			}
		});

		this.ffplay = ffplay;
		this.backend = "ffplay";
		this.initialized = true;
		this.dropUntilDrain = false;

		const silence = Buffer.alloc(AUDIO_PRIME_FRAMES * 4, 0);
		for (let i = 0; i < AUDIO_PRIME_CHUNKS; i++) {
			if (ffplay.stdin.destroyed) break;
			ffplay.stdin.write(silence);
		}
	}

	private getAutoOrder(): AudioBackendPreference[] {
		return process.platform === "darwin" ? ["ffplay", "speaker"] : ["speaker", "ffplay"];
	}

	async init(): Promise<void> {
		if (this.initialized) return;

		const order =
			this.preference === "auto"
				? this.getAutoOrder()
				: ([this.preference] as AudioBackendPreference[]);

		const errors: string[] = [];
		for (const backend of order) {
			try {
				if (backend === "speaker") {
					await this.initSpeakerBackend();
				} else {
					await this.initFfplayBackend();
				}
				return;
			} catch (error) {
				this.close();
				errors.push(`${backend} backend failed (${error instanceof Error ? error.message : String(error)})`);
			}
		}

		throw new Error(errors.join("; "));
	}

	getBackendLabel(): AudioBackendLabel {
		return this.backend;
	}

	private shouldDropChunk(target: { writableNeedDrain?: boolean; writableLength?: number }): boolean {
		if (this.dropUntilDrain) return true;
		const backlog = typeof target.writableLength === "number" ? target.writableLength : 0;
		if (target.writableNeedDrain || backlog > AUDIO_MAX_QUEUE_BYTES) {
			this.dropUntilDrain = true;
			return true;
		}
		return false;
	}

	private writeToTarget(target: {
		write: (buffer: Buffer) => boolean;
		writableNeedDrain?: boolean;
		writableLength?: number;
		destroyed?: boolean;
	}, output: Buffer): boolean {
		if (target.destroyed) return false;
		if (this.shouldDropChunk(target)) return true;
		try {
			const ok = target.write(output);
			if (!ok) {
				this.dropUntilDrain = true;
			}
			return true;
		} catch {
			this.close();
			return false;
		}
	}

	private writePcm(output: Buffer): boolean {
		if (!this.initialized) return false;

		if (this.backend === "speaker" && this.speaker) {
			return this.writeToTarget(this.speaker, output);
		}

		if (this.backend === "ffplay" && this.ffplay) {
			if (this.ffplay.stdin.destroyed || this.ffplay.killed) return false;
			return this.writeToTarget(this.ffplay.stdin, output);
		}

		return false;
	}

	writeSamples(samples: ArrayLike<number> | null | undefined, inputSampleRate = MGBA_AUDIO_INPUT_SAMPLE_RATE): boolean {
		if (!this.initialized || !samples) return true;
		if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) return false;

		const stereoFrames = Math.floor(samples.length / 2);
		if (stereoFrames <= 0) return true;

		const output = Buffer.allocUnsafe(stereoFrames * 12);
		let outOffset = 0;

		for (let i = 0; i < stereoFrames; i++) {
			const leftRaw = Number(samples[i * 2] ?? -1);
			const rightRaw = Number(samples[i * 2 + 1] ?? leftRaw);

			this.dcLeft += (leftRaw - this.dcLeft) * AUDIO_DC_ALPHA;
			this.dcRight += (rightRaw - this.dcRight) * AUDIO_DC_ALPHA;

			const leftCentered = leftRaw - this.dcLeft;
			const rightCentered = rightRaw - this.dcRight;
			this.filteredLeft += (leftCentered - this.filteredLeft) * AUDIO_LOW_PASS_ALPHA;
			this.filteredRight += (rightCentered - this.filteredRight) * AUDIO_LOW_PASS_ALPHA;

			const left = Math.max(-1, Math.min(1, this.filteredLeft * AUDIO_GAIN));
			const right = Math.max(-1, Math.min(1, this.filteredRight * AUDIO_GAIN));

			const leftPcm = left < 0 ? Math.round(left * 32768) : Math.round(left * 32767);
			const rightPcm = right < 0 ? Math.round(right * 32768) : Math.round(right * 32767);

			this.resampleCarry += AUDIO_OUTPUT_SAMPLE_RATE;
			let repeats = 0;
			while (this.resampleCarry >= inputSampleRate) {
				this.resampleCarry -= inputSampleRate;
				repeats++;
			}

			for (let r = 0; r < repeats; r++) {
				output.writeInt16LE(leftPcm, outOffset);
				output.writeInt16LE(rightPcm, outOffset + 2);
				outOffset += 4;
			}
		}

		if (outOffset <= 0) return true;
		return this.writePcm(output.subarray(0, outOffset));
	}

	close(): void {
		if (this.speaker) {
			try {
				this.speaker.end();
			} catch {
				// noop
			}
			this.speaker = null;
		}

		if (this.ffplay) {
			const proc = this.ffplay;
			this.ffplay = null;
			try {
				if (!proc.stdin.destroyed) proc.stdin.end();
			} catch {
				// noop
			}
			try {
				proc.kill("SIGTERM");
			} catch {
				// noop
			}
			setTimeout(() => {
				try {
					if (!proc.killed) proc.kill("SIGKILL");
				} catch {
					// noop
				}
			}, 250).unref();
		}

		this.backend = "none";
		this.initialized = false;
		this.dcLeft = -1;
		this.dcRight = -1;
		this.filteredLeft = 0;
		this.filteredRight = 0;
		this.resampleCarry = 0;
		this.dropUntilDrain = false;
	}
}
