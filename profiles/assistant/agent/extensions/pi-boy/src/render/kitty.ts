import { Buffer } from "node:buffer";
import { allocateImageId, deleteKittyImage, getCellDimensions, renderImage, type TUI } from "@mariozechner/pi-tui";
import pngjs from "pngjs";
import {
	GB_HEIGHT,
	GB_WIDTH,
	MAX_INTEGER_UPSCALE,
	MIN_IMAGE_COLUMNS,
	PNG_DEFLATE_LEVEL,
	PNG_FILTER_TYPE,
} from "../constants.js";

const { PNG } = pngjs as unknown as {
	PNG: {
		sync: {
			write: (
				png: { data: Buffer; width: number; height: number },
				options?: {
					colorType?: number;
					inputHasAlpha?: boolean;
					inputColorType?: number;
					deflateLevel?: number;
					filterType?: number;
				},
			) => Buffer;
		};
		new (options: { width: number; height: number }): { data: Buffer; width: number; height: number };
	};
};

export class KittyRenderer {
	private imageId: number | undefined;
	private cachedVersion = -1;
	private cachedScale = -1;
	private cachedBase64: string | null = null;
	private previousRows = 0;

	invalidate(): void {
		this.cachedVersion = -1;
	}

	private computeIntegerScale(targetCols: number, targetRows: number): number {
		const cell = getCellDimensions();
		const cellWidthPx = Math.max(1, cell.widthPx);
		const cellHeightPx = Math.max(1, cell.heightPx);
		const maxWidthPx = Math.max(GB_WIDTH, Math.floor(targetCols * cellWidthPx));
		const maxHeightPx = Math.max(GB_HEIGHT, Math.floor(targetRows * cellHeightPx));
		const widthScale = Math.floor(maxWidthPx / GB_WIDTH);
		const heightScale = Math.floor(maxHeightPx / GB_HEIGHT);
		return Math.max(1, Math.min(MAX_INTEGER_UPSCALE, widthScale, heightScale));
	}

	private computeTargetColumns(width: number, maxRows: number): number {
		const cell = getCellDimensions();
		const cellWidthPx = Math.max(1, cell.widthPx);
		const cellHeightPx = Math.max(1, cell.heightPx);
		const colsByHeight = Math.floor((maxRows * GB_WIDTH * cellHeightPx) / (GB_HEIGHT * cellWidthPx));
		return Math.max(1, Math.min(width, Math.max(MIN_IMAGE_COLUMNS, colsByHeight)));
	}

	private buildUpscaledPng(screen: ArrayLike<number>, scale: number): { data: Buffer; width: number; height: number } {
		const width = GB_WIDTH * scale;
		const height = GB_HEIGHT * scale;
		const png = new PNG({ width, height });
		const rowBuffer = Buffer.allocUnsafe(width * 4);

		for (let y = 0; y < GB_HEIGHT; y++) {
			const srcRowOffset = y * GB_WIDTH * 4;
			let rowOffset = 0;

			for (let x = 0; x < GB_WIDTH; x++) {
				const srcOffset = srcRowOffset + x * 4;
				const r = Number(screen[srcOffset] ?? 0);
				const g = Number(screen[srcOffset + 1] ?? 0);
				const b = Number(screen[srcOffset + 2] ?? 0);
				for (let sx = 0; sx < scale; sx++) {
					rowBuffer[rowOffset] = r;
					rowBuffer[rowOffset + 1] = g;
					rowBuffer[rowOffset + 2] = b;
					rowBuffer[rowOffset + 3] = 255;
					rowOffset += 4;
				}
			}

			for (let sy = 0; sy < scale; sy++) {
				rowBuffer.copy(png.data, (y * scale + sy) * width * 4);
			}
		}

		return png;
	}

	private encodeFrame(screen: ArrayLike<number>, version: number, targetCols: number, targetRows: number) {
		const scale = this.computeIntegerScale(targetCols, targetRows);
		if (this.cachedVersion === version && this.cachedScale === scale && this.cachedBase64) {
			return {
				base64: this.cachedBase64,
				widthPx: GB_WIDTH * scale,
				heightPx: GB_HEIGHT * scale,
				scale,
			};
		}

		const png = this.buildUpscaledPng(screen, scale);
		const buffer = PNG.sync.write(png, {
			colorType: 6,
			inputColorType: 6,
			inputHasAlpha: true,
			deflateLevel: PNG_DEFLATE_LEVEL,
			filterType: PNG_FILTER_TYPE,
		});

		this.cachedBase64 = buffer.toString("base64");
		this.cachedVersion = version;
		this.cachedScale = scale;
		return {
			base64: this.cachedBase64,
			widthPx: png.width,
			heightPx: png.height,
			scale,
		};
	}

	render(screen: ArrayLike<number>, version: number, width: number, maxRows: number): { lines: string[]; scale: number } | null {
		const targetCols = this.computeTargetColumns(width, maxRows);
		const encoded = this.encodeFrame(screen, version, targetCols, maxRows);
		if (!this.imageId) {
			this.imageId = allocateImageId();
		}

		const result = renderImage(
			encoded.base64,
			{ widthPx: encoded.widthPx, heightPx: encoded.heightPx },
			{
				maxWidthCells: targetCols,
				maxHeightCells: maxRows,
				imageId: this.imageId,
			},
		);
		if (!result) return null;
		if (result.imageId) {
			this.imageId = result.imageId;
		}

		const reserveRows = Math.max(result.rows, this.previousRows);
		this.previousRows = result.rows;
		const leftPadCols = Math.max(0, Math.floor((width - targetCols) / 2));
		const moveToColumn = leftPadCols > 0 ? `\x1b[${leftPadCols + 1}G` : "";
		const moveUp = result.rows > 1 ? `\x1b[${result.rows - 1}A` : "";

		const lines: string[] = [];
		for (let i = 0; i < result.rows - 1; i++) lines.push("");
		lines.push(moveUp + moveToColumn + result.sequence);
		for (let i = result.rows; i < reserveRows; i++) lines.push(" ".repeat(width));
		return { lines, scale: encoded.scale };
	}

	dispose(tui: TUI): void {
		if (this.imageId) {
			try {
				tui.terminal?.write(deleteKittyImage(this.imageId));
			} catch {
				// ignore
			}
			this.imageId = undefined;
		}
		this.previousRows = 0;
	}
}
