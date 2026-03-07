import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
	CMD_DO_FRAME,
	CMD_GET_AUDIO,
	CMD_LOAD_ROM,
	CMD_LOAD_STATE,
	CMD_SAVE_STATE,
	CMD_SET_KEYS,
	CMD_SHUTDOWN,
	HEADER_BYTES,
	MAX_RESPONSE_BYTES,
	STATUS_OK,
	STDERR_BUFFER_LIMIT,
} from "./protocol.js";
import { resolveMgbaBridgeBinaryPath } from "./bridge-bin.js";
import { getPipeFd, readExact, writeAll } from "./stdio.js";

export class MgbaBridge {
	private process: ChildProcessWithoutNullStreams | null = null;
	private stdinFd: number | null = null;
	private stdoutFd: number | null = null;
	private stderrTail = "";
	private disposed = false;

	private ensureStarted(): void {
		if (this.disposed) {
			throw new Error("mGBA backend already disposed");
		}

		if (this.process && this.stdinFd !== null && this.stdoutFd !== null) {
			return;
		}

		this.stderrTail = "";
		const binaryPath = resolveMgbaBridgeBinaryPath();
		const bridgeProcess = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });

		bridgeProcess.stderr.setEncoding("utf8");
		bridgeProcess.stderr.on("data", (chunk: string | Buffer) => {
			const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
			this.stderrTail = `${this.stderrTail}${text}`;
			if (this.stderrTail.length > STDERR_BUFFER_LIMIT) {
				this.stderrTail = this.stderrTail.slice(-STDERR_BUFFER_LIMIT);
			}
		});

		bridgeProcess.on("exit", () => {
			this.process = null;
			this.stdinFd = null;
			this.stdoutFd = null;
		});

		this.process = bridgeProcess;
		this.stdinFd = getPipeFd(bridgeProcess.stdin as unknown as { _handle?: { fd?: number } }, "stdin");
		this.stdoutFd = getPipeFd(bridgeProcess.stdout as unknown as { _handle?: { fd?: number } }, "stdout");
	}

	reset(): void {
		if (this.process) {
			try {
				this.process.kill("SIGTERM");
			} catch {
				// noop
			}
		}
		this.process = null;
		this.stdinFd = null;
		this.stdoutFd = null;
	}

	private sendCommand(command: number, payload: Buffer = Buffer.alloc(0)): Buffer {
		this.ensureStarted();
		if (this.stdinFd === null || this.stdoutFd === null) {
			throw new Error("mGBA bridge is not ready");
		}

		try {
			const header = Buffer.allocUnsafe(HEADER_BYTES);
			header[0] = command;
			header.writeUInt32LE(payload.length, 1);
			writeAll(this.stdinFd, header);
			if (payload.length > 0) {
				writeAll(this.stdinFd, payload);
			}

			const responseHeader = readExact(this.stdoutFd, HEADER_BYTES);
			const status = responseHeader[0] ?? 1;
			const responseLength = responseHeader.readUInt32LE(1);
			if (responseLength > MAX_RESPONSE_BYTES) {
				throw new Error(`mGBA bridge response too large: ${responseLength} bytes`);
			}

			const responsePayload = readExact(this.stdoutFd, responseLength);
			if (status !== STATUS_OK) {
				const message = responsePayload.toString("utf8").trim() || "unknown mGBA bridge error";
				const stderr = this.stderrTail.trim();
				const extra = stderr ? `\nbridge stderr:\n${stderr}` : "";
				throw new Error(`${message}${extra}`);
			}

			return responsePayload;
		} catch (error) {
			this.reset();
			if (error instanceof Error) throw error;
			throw new Error(String(error));
		}
	}

	loadRom(romData: Buffer): void {
		this.sendCommand(CMD_LOAD_ROM, romData);
	}

	setKeys(keys: Buffer): void {
		this.sendCommand(CMD_SET_KEYS, keys);
	}

	doFrame(): Buffer {
		return this.sendCommand(CMD_DO_FRAME);
	}

	getAudioPayload(): Buffer {
		return this.sendCommand(CMD_GET_AUDIO);
	}

	saveState(): Buffer {
		return this.sendCommand(CMD_SAVE_STATE);
	}

	loadState(state: Buffer): void {
		this.sendCommand(CMD_LOAD_STATE, state);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.process && this.stdinFd !== null && this.stdoutFd !== null) {
			try {
				this.sendCommand(CMD_SHUTDOWN);
			} catch {
				// noop
			}
		}
		this.reset();
	}
}
