import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { SAVE_STATE_DIR } from "./constants.js";

const SAVE_STATE_EXT = ".state";

export interface SaveStateEntry {
	name: string;
	path: string;
	sizeBytes: number;
	modifiedMs: number;
}

function sanitizeFilenamePart(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
	return normalized.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getRomStateBasename(romPath: string): string {
	const base = basename(romPath, extname(romPath));
	const safeBase = sanitizeFilenamePart(base) || "rom";
	const digest = createHash("sha1").update(romPath).digest("hex").slice(0, 12);
	return `${safeBase}-${digest}${SAVE_STATE_EXT}`;
}

export function getSaveStatePath(romPath: string): string {
	return join(SAVE_STATE_DIR, getRomStateBasename(romPath));
}

export function loadSaveState(romPath: string): Buffer | null {
	const statePath = getSaveStatePath(romPath);
	if (!existsSync(statePath)) return null;
	try {
		const data = readFileSync(statePath);
		return data.length > 0 ? data : null;
	} catch {
		return null;
	}
}

export function writeSaveState(romPath: string, state: Buffer): string {
	const statePath = getSaveStatePath(romPath);
	mkdirSync(SAVE_STATE_DIR, { recursive: true });
	writeFileSync(statePath, state);
	return statePath;
}

export function removeSaveState(romPath: string): boolean {
	const statePath = getSaveStatePath(romPath);
	return removeSaveStateByPath(statePath);
}

export function removeSaveStateByPath(statePath: string): boolean {
	if (!existsSync(statePath)) return false;
	try {
		unlinkSync(statePath);
		return !existsSync(statePath);
	} catch {
		return false;
	}
}

export function listSaveStates(): SaveStateEntry[] {
	if (!existsSync(SAVE_STATE_DIR)) return [];

	let entries: string[] = [];
	try {
		entries = readdirSync(SAVE_STATE_DIR);
	} catch {
		return [];
	}

	const states: SaveStateEntry[] = [];
	for (const name of entries) {
		if (!name.endsWith(SAVE_STATE_EXT)) continue;
		const path = join(SAVE_STATE_DIR, name);
		try {
			const stat = statSync(path);
			if (!stat.isFile()) continue;
			states.push({
				name,
				path,
				sizeBytes: stat.size,
				modifiedMs: stat.mtimeMs,
			});
		} catch {
			// skip unreadable entries
		}
	}

	states.sort((a, b) => b.modifiedMs - a.modifiedMs);
	return states;
}
