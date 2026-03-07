import { GB_WIDTH } from "../constants.js";
import type { AnsiBlockMode } from "../runtime.js";

const QUADRANT_GLYPHS = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];

function colorDistanceSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	const dr = r1 - r2;
	const dg = g1 - g2;
	const db = b1 - b2;
	return dr * dr + dg * dg + db * db;
}

function computeMaskMeans(mask: number, count: number, rs: number[], gs: number[], bs: number[]):
	| { fgR: number; fgG: number; fgB: number; bgR: number; bgG: number; bgB: number }
	| null {
	let fgR = 0;
	let fgG = 0;
	let fgB = 0;
	let bgR = 0;
	let bgG = 0;
	let bgB = 0;
	let fgCount = 0;
	let bgCount = 0;

	for (let i = 0; i < count; i++) {
		if ((mask & (1 << i)) !== 0) {
			fgR += rs[i] ?? 0;
			fgG += gs[i] ?? 0;
			fgB += bs[i] ?? 0;
			fgCount++;
		} else {
			bgR += rs[i] ?? 0;
			bgG += gs[i] ?? 0;
			bgB += bs[i] ?? 0;
			bgCount++;
		}
	}

	if (fgCount === 0 || bgCount === 0) return null;
	return {
		fgR: fgR / fgCount,
		fgG: fgG / fgCount,
		fgB: fgB / fgCount,
		bgR: bgR / bgCount,
		bgG: bgG / bgCount,
		bgB: bgB / bgCount,
	};
}

function renderHalfBlock(
	rgba: ArrayLike<number>,
	sourceWidth: number,
	sourceHeight: number,
	targetCols: number,
	targetRows: number,
): string[] {
	const lines: string[] = [];
	const scaleX = sourceWidth / targetCols;
	const scaleY = sourceHeight / (targetRows * 2);

	for (let row = 0; row < targetRows; row++) {
		let line = "";
		let previousFg = "";
		let previousBg = "";
		const srcY1 = Math.min(sourceHeight - 1, Math.floor(row * 2 * scaleY));
		const srcY2 = Math.min(sourceHeight - 1, Math.floor((row * 2 + 1) * scaleY));

		for (let col = 0; col < targetCols; col++) {
			const srcX = Math.min(sourceWidth - 1, Math.floor(col * scaleX));
			const idx1 = (srcY1 * sourceWidth + srcX) * 4;
			const idx2 = (srcY2 * sourceWidth + srcX) * 4;

			const fg = `${Number(rgba[idx1] ?? 0)};${Number(rgba[idx1 + 1] ?? 0)};${Number(rgba[idx1 + 2] ?? 0)}`;
			const bg = `${Number(rgba[idx2] ?? 0)};${Number(rgba[idx2 + 1] ?? 0)};${Number(rgba[idx2 + 2] ?? 0)}`;
			if (fg !== previousFg || bg !== previousBg) {
				line += `\x1b[38;2;${fg}m\x1b[48;2;${bg}m`;
				previousFg = fg;
				previousBg = bg;
			}
			line += "▀";
		}

		line += "\x1b[0m";
		lines.push(line);
	}

	return lines;
}

function renderQuarterBlock(
	rgba: ArrayLike<number>,
	sourceWidth: number,
	sourceHeight: number,
	targetCols: number,
	targetRows: number,
): string[] {
	const lines: string[] = [];
	const scaleX = sourceWidth / (targetCols * 2);
	const scaleY = sourceHeight / (targetRows * 2);

	for (let row = 0; row < targetRows; row++) {
		let line = "";
		let previousFg = "";
		let previousBg = "";
		const srcYTop = Math.min(sourceHeight - 1, Math.floor(row * 2 * scaleY));
		const srcYBottom = Math.min(sourceHeight - 1, Math.floor((row * 2 + 1) * scaleY));

		for (let col = 0; col < targetCols; col++) {
			const srcXLeft = Math.min(sourceWidth - 1, Math.floor(col * 2 * scaleX));
			const srcXRight = Math.min(sourceWidth - 1, Math.floor((col * 2 + 1) * scaleX));

			const idxUL = (srcYTop * sourceWidth + srcXLeft) * 4;
			const idxUR = (srcYTop * sourceWidth + srcXRight) * 4;
			const idxLL = (srcYBottom * sourceWidth + srcXLeft) * 4;
			const idxLR = (srcYBottom * sourceWidth + srcXRight) * 4;

			const rs = [
				Number(rgba[idxUL] ?? 0),
				Number(rgba[idxUR] ?? 0),
				Number(rgba[idxLL] ?? 0),
				Number(rgba[idxLR] ?? 0),
			];
			const gs = [
				Number(rgba[idxUL + 1] ?? 0),
				Number(rgba[idxUR + 1] ?? 0),
				Number(rgba[idxLL + 1] ?? 0),
				Number(rgba[idxLR + 1] ?? 0),
			];
			const bs = [
				Number(rgba[idxUL + 2] ?? 0),
				Number(rgba[idxUR + 2] ?? 0),
				Number(rgba[idxLL + 2] ?? 0),
				Number(rgba[idxLR + 2] ?? 0),
			];

			const meanR = (rs[0] + rs[1] + rs[2] + rs[3]) * 0.25;
			const meanG = (gs[0] + gs[1] + gs[2] + gs[3]) * 0.25;
			const meanB = (bs[0] + bs[1] + bs[2] + bs[3]) * 0.25;

			let seedIndex = 0;
			let seedDistance = -1;
			for (let i = 0; i < 4; i++) {
				const distance = colorDistanceSq(rs[i], gs[i], bs[i], meanR, meanG, meanB);
				if (distance > seedDistance) {
					seedDistance = distance;
					seedIndex = i;
				}
			}

			let mask = 0;
			for (let i = 0; i < 4; i++) {
				const distanceToFg = colorDistanceSq(rs[i], gs[i], bs[i], rs[seedIndex], gs[seedIndex], bs[seedIndex]);
				const distanceToBg = colorDistanceSq(rs[i], gs[i], bs[i], meanR, meanG, meanB);
				if (distanceToFg <= distanceToBg) {
					mask |= 1 << i;
				}
			}

			if (mask === 0 || mask === 15) {
				mask = 1 << seedIndex;
			}

			let means = computeMaskMeans(mask, 4, rs, gs, bs);
			if (!means) {
				means = { fgR: meanR, fgG: meanG, fgB: meanB, bgR: meanR, bgG: meanG, bgB: meanB };
			}

			let refinedMask = 0;
			for (let i = 0; i < 4; i++) {
				const distanceToFg = colorDistanceSq(rs[i], gs[i], bs[i], means.fgR, means.fgG, means.fgB);
				const distanceToBg = colorDistanceSq(rs[i], gs[i], bs[i], means.bgR, means.bgG, means.bgB);
				if (distanceToFg <= distanceToBg) {
					refinedMask |= 1 << i;
				}
			}

			if (refinedMask !== 0 && refinedMask !== 15) {
				const refinedMeans = computeMaskMeans(refinedMask, 4, rs, gs, bs);
				if (refinedMeans) {
					mask = refinedMask;
					means = refinedMeans;
				}
			}

			const fg = `${Math.round(means.fgR)};${Math.round(means.fgG)};${Math.round(means.fgB)}`;
			const bg = `${Math.round(means.bgR)};${Math.round(means.bgG)};${Math.round(means.bgB)}`;
			if (fg !== previousFg || bg !== previousBg) {
				line += `\x1b[38;2;${fg}m\x1b[48;2;${bg}m`;
				previousFg = fg;
				previousBg = bg;
			}

			line += QUADRANT_GLYPHS[mask] ?? "█";
		}

		line += "\x1b[0m";
		lines.push(line);
	}

	return lines;
}

export function computeAnsiViewport(
	mode: AnsiBlockMode,
	maxCols: number,
	maxRows: number,
	sourceHeight: number,
): { cols: number; rows: number } {
	if (mode === "quarter") {
		const colsByHeight = Math.floor((maxRows * GB_WIDTH) / Math.max(1, sourceHeight));
		if (colsByHeight <= maxCols) {
			return { cols: Math.max(1, colsByHeight), rows: maxRows };
		}
		const rowsByWidth = Math.floor((maxCols * sourceHeight) / GB_WIDTH);
		return { cols: maxCols, rows: Math.max(1, rowsByWidth) };
	}

	const colsByHeight = Math.floor((maxRows * 2 * GB_WIDTH) / Math.max(1, sourceHeight));
	if (colsByHeight <= maxCols) {
		return { cols: Math.max(1, colsByHeight), rows: maxRows };
	}
	const rowsByWidth = Math.floor((maxCols * sourceHeight) / (2 * GB_WIDTH));
	return { cols: maxCols, rows: Math.max(1, rowsByWidth) };
}

export function renderAnsiFrame(
	rgba: ArrayLike<number>,
	sourceWidth: number,
	sourceHeight: number,
	mode: AnsiBlockMode,
	maxCols: number,
	maxRows: number,
): string[] {
	const viewport = computeAnsiViewport(mode, maxCols, maxRows, sourceHeight);
	if (mode === "quarter") {
		return renderQuarterBlock(rgba, sourceWidth, sourceHeight, viewport.cols, viewport.rows);
	}
	return renderHalfBlock(rgba, sourceWidth, sourceHeight, viewport.cols, viewport.rows);
}
