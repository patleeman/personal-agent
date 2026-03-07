import { readSync, writeSync } from "node:fs";

const IO_RETRY_SLEEP = new Int32Array(new SharedArrayBuffer(4));
const IO_TIMEOUT_MS = 15_000;

export function getPipeFd(pipe: { _handle?: { fd?: number } } | null | undefined, label: string): number {
	const fd = pipe?._handle?.fd;
	if (typeof fd !== "number") {
		throw new Error(`mGBA bridge ${label} pipe is unavailable`);
	}
	return fd;
}

function sleepForIoRetry(): void {
	Atomics.wait(IO_RETRY_SLEEP, 0, 0, 1);
}

function isRetryableIoError(error: unknown): error is NodeJS.ErrnoException {
	if (!(error instanceof Error)) return false;
	const code = (error as NodeJS.ErrnoException).code;
	return code === "EAGAIN" || code === "EWOULDBLOCK" || code === "EINTR";
}

export function writeAll(fd: number, buffer: Buffer): void {
	let offset = 0;
	const deadline = Date.now() + IO_TIMEOUT_MS;

	while (offset < buffer.length) {
		try {
			const written = writeSync(fd, buffer, offset, buffer.length - offset);
			if (written > 0) {
				offset += written;
				continue;
			}
		} catch (error) {
			if (!isRetryableIoError(error)) throw error;
		}

		if (Date.now() > deadline) {
			throw new Error("Timed out writing to mGBA bridge");
		}
		sleepForIoRetry();
	}
}

export function readExact(fd: number, length: number): Buffer {
	if (length <= 0) return Buffer.alloc(0);

	const output = Buffer.allocUnsafe(length);
	let offset = 0;
	const deadline = Date.now() + IO_TIMEOUT_MS;

	while (offset < length) {
		try {
			const bytesRead = readSync(fd, output, offset, length - offset, null);
			if (bytesRead > 0) {
				offset += bytesRead;
				continue;
			}
			if (bytesRead === 0) {
				throw new Error("mGBA bridge closed unexpectedly");
			}
		} catch (error) {
			if (!isRetryableIoError(error)) throw error;
		}

		if (Date.now() > deadline) {
			throw new Error("Timed out reading from mGBA bridge");
		}
		sleepForIoRetry();
	}

	return output;
}
