import { readdirSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { resolveInputPath } from "./config.js";

const ROM_EXTENSIONS = new Set([".gb", ".gbc"]);
const DEFAULT_ROM_SCAN_LIMIT = 500;

export function isRomFilePath(filePath: string): boolean {
	return ROM_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function stripWrappingQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function quoteIfNeeded(value: string): string {
	return /\s/.test(value) ? JSON.stringify(value) : value;
}

export function listRomFiles(romDirectory: string, maxResults = DEFAULT_ROM_SCAN_LIMIT): string[] {
	const root = resolveInputPath(romDirectory, process.cwd());
	const files: string[] = [];
	const stack = [root];

	while (stack.length > 0) {
		const dirPath = stack.pop();
		if (!dirPath) continue;

		let entries;
		try {
			entries = readdirSync(dirPath, { withFileTypes: true });
		} catch {
			continue;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

		for (const entry of entries) {
			const fullPath = join(dirPath, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}

			if (!entry.isFile() || !isRomFilePath(fullPath)) continue;
			files.push(fullPath);
			if (files.length >= maxResults) {
				return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
			}
		}
	}

	return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function collectDirectoryCompletions(searchDir: string, namePrefix: string, maxResults: number): AutocompleteItem[] {
	let entries;
	try {
		entries = readdirSync(searchDir, { withFileTypes: true });
	} catch {
		return [];
	}

	const lowerPrefix = namePrefix.toLowerCase();
	const completions: AutocompleteItem[] = [];

	entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
	for (const entry of entries) {
		if (!entry.name.toLowerCase().startsWith(lowerPrefix)) continue;
		const fullPath = join(searchDir, entry.name);
		if (entry.isDirectory()) {
			completions.push({ value: quoteIfNeeded(`${fullPath}/`), label: `${entry.name}/` });
		} else if (entry.isFile() && isRomFilePath(fullPath)) {
			completions.push({ value: quoteIfNeeded(fullPath), label: entry.name });
		}

		if (completions.length >= maxResults) break;
	}

	return completions;
}

function splitPathPrefix(prefix: string): { basePath: string; namePrefix: string } {
	if (prefix.endsWith("/")) {
		return { basePath: prefix, namePrefix: "" };
	}

	const slash = prefix.lastIndexOf("/");
	if (slash < 0) {
		return { basePath: ".", namePrefix: prefix };
	}

	return {
		basePath: slash === 0 ? "/" : prefix.slice(0, slash),
		namePrefix: prefix.slice(slash + 1),
	};
}

export function getRomPathCompletions(
	argumentPrefix: string,
	cwd: string,
	romDirectory?: string,
	maxResults = 50,
): AutocompleteItem[] | null {
	const strippedPrefix = stripWrappingQuotes(argumentPrefix);
	const normalizedPrefix = strippedPrefix.trim();
	const seen = new Map<string, AutocompleteItem>();

	const add = (item: AutocompleteItem): void => {
		if (seen.has(item.value) || seen.size >= maxResults) return;
		seen.set(item.value, item);
	};

	const resolvedRomDirectory = romDirectory ? resolveInputPath(romDirectory, cwd) : undefined;

	if (normalizedPrefix.length === 0) {
		if (resolvedRomDirectory) {
			for (const romPath of listRomFiles(resolvedRomDirectory, maxResults)) {
				const rel = relative(resolvedRomDirectory, romPath);
				add({ value: quoteIfNeeded(romPath), label: rel });
			}
		}

		if (seen.size === 0) {
			for (const item of collectDirectoryCompletions(cwd, "", maxResults)) add(item);
		}

		return seen.size > 0 ? [...seen.values()] : null;
	}

	const isPathPrefix =
		normalizedPrefix.includes("/") || normalizedPrefix.startsWith("~") || normalizedPrefix.startsWith(".");

	if (isPathPrefix) {
		const { basePath, namePrefix } = splitPathPrefix(normalizedPrefix);
		const searchDir = resolveInputPath(basePath, cwd);
		for (const item of collectDirectoryCompletions(searchDir, namePrefix, maxResults)) add(item);
		return seen.size > 0 ? [...seen.values()] : null;
	}

	const lowerPrefix = normalizedPrefix.toLowerCase();
	if (resolvedRomDirectory) {
		for (const romPath of listRomFiles(resolvedRomDirectory, maxResults * 4)) {
			const rel = relative(resolvedRomDirectory, romPath);
			const relLower = rel.toLowerCase();
			const nameLower = basename(romPath).toLowerCase();
			if (!relLower.startsWith(lowerPrefix) && !nameLower.startsWith(lowerPrefix)) continue;
			add({ value: quoteIfNeeded(romPath), label: rel });
			if (seen.size >= maxResults) break;
		}
	}

	for (const item of collectDirectoryCompletions(cwd, normalizedPrefix, maxResults)) add(item);
	return seen.size > 0 ? [...seen.values()] : null;
}
