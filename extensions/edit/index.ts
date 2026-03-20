import * as Diff from "diff";
import { createEditTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { constants } from "node:fs";
import {
	access as fsAccess,
	readFile as fsReadFile,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import { resolve } from "node:path";

const editSchema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldText: Type.Optional(
		Type.String({
			description: "Exact text to find and replace. Use with newText for one precise replacement.",
		}),
	),
	newText: Type.Optional(
		Type.String({
			description: "Replacement text for oldText.",
		}),
	),
	old_string: Type.Optional(
		Type.String({
			description: "Alias for oldText.",
		}),
	),
	new_string: Type.Optional(
		Type.String({
			description: "Alias for newText.",
		}),
	),
	edits: Type.Optional(
		Type.Array(
			Type.Object({
				oldText: Type.String({ description: "Exact text to find and replace for this edit." }),
				newText: Type.String({ description: "Replacement text for this edit." }),
			}),
			{
				description: "Multiple exact replacements in one file. Prefer this for multiple precise edits in the same file.",
			},
		),
	),
});

type ReplaceEdit = {
	oldText: string;
	newText: string;
};

type EditInput = {
	path: string;
	oldText?: string;
	newText?: string;
	old_string?: string;
	new_string?: string;
	edits?: ReplaceEdit[];
};

type ReplaceModeInput = {
	path: string;
	oldText: string;
	newText: string;
};

type MultiReplaceModeInput = {
	path: string;
	edits: ReplaceEdit[];
};

type RenderedDiff = {
	diff: string;
	firstChangedLine: number | undefined;
};

const fileMutationQueues = new Map<string, Promise<void>>();

function stripLeadingAt(path: string): string {
	return path.startsWith("@") ? path.slice(1) : path;
}

function resolveToCwd(path: string, cwd: string): string {
	return resolve(cwd, stripLeadingAt(path));
}

function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");

	if (lfIdx === -1) {
		return "\n";
	}

	if (crlfIdx === -1) {
		return "\n";
	}

	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

type FuzzyMatchResult = {
	found: boolean;
	index: number;
	matchLength: number;
	usedFuzzyMatch: boolean;
	contentForReplacement: string;
};

function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);
	if (fuzzyIndex === -1) {
		return {
			found: false,
			index: -1,
			matchLength: 0,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	return {
		found: true,
		index: fuzzyIndex,
		matchLength: fuzzyOldText.length,
		usedFuzzyMatch: true,
		contentForReplacement: fuzzyContent,
	};
}

function generateDiffString(oldContent: string, newContent: string, contextLines = 4): RenderedDiff {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];
	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;
	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}

			lastWasChange = true;
			continue;
		}

		const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
		if (lastWasChange || nextPartIsChange) {
			let linesToShow = raw;
			let skipStart = 0;
			let skipEnd = 0;

			if (!lastWasChange) {
				skipStart = Math.max(0, raw.length - contextLines);
				linesToShow = raw.slice(skipStart);
			}

			if (!nextPartIsChange && linesToShow.length > contextLines) {
				skipEnd = linesToShow.length - contextLines;
				linesToShow = linesToShow.slice(0, contextLines);
			}

			if (skipStart > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skipStart;
				newLineNum += skipStart;
			}

			for (const line of linesToShow) {
				const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
				output.push(` ${lineNum} ${line}`);
				oldLineNum++;
				newLineNum++;
			}

			if (skipEnd > 0) {
				output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
				oldLineNum += skipEnd;
				newLineNum += skipEnd;
			}
		} else {
			oldLineNum += raw.length;
			newLineNum += raw.length;
		}

		lastWasChange = false;
	}

	return { diff: output.join("\n"), firstChangedLine };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new Error("Operation aborted");
	}
}

async function withFileMutationQueue<T>(path: string, work: () => Promise<T>): Promise<T> {
	const previous = fileMutationQueues.get(path) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(work);
	const queued = run.then(() => undefined, () => undefined);
	fileMutationQueues.set(path, queued);

	try {
		return await run;
	} finally {
		if (fileMutationQueues.get(path) === queued) {
			fileMutationQueues.delete(path);
		}
	}
}

function getMultiReplaceModeInput(input: EditInput): MultiReplaceModeInput | null {
	if (input.edits === undefined) {
		return null;
	}

	if (
		input.oldText !== undefined
		|| input.newText !== undefined
		|| input.old_string !== undefined
		|| input.new_string !== undefined
	) {
		throw new Error("Edit tool input is invalid. Use either edits or single replacement mode, not both.");
	}

	if (input.edits.length === 0) {
		throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
	}

	return { path: input.path, edits: input.edits };
}

function getReplaceModeInput(input: EditInput): ReplaceModeInput | null {
	const oldText = input.oldText ?? input.old_string;
	const newText = input.newText ?? input.new_string;

	if (oldText === undefined && newText === undefined) {
		return null;
	}

	if (input.edits !== undefined) {
		throw new Error("Edit tool input is invalid. Use either single replacement mode or edits mode, not both.");
	}

	if (oldText === undefined || newText === undefined) {
		throw new Error("Edit tool input is invalid. Replacement mode requires both oldText and newText.");
	}

	return { path: input.path, oldText, newText };
}

async function readNormalizedFile(
	path: string,
	displayPath: string,
	signal: AbortSignal | undefined,
): Promise<{ normalizedContent: string; bom: string; originalEnding: "\r\n" | "\n" }> {
	throwIfAborted(signal);

	try {
		await fsAccess(path, constants.R_OK | constants.W_OK);
	} catch {
		throw new Error(`File not found: ${displayPath}`);
	}

	const rawContent = await fsReadFile(path, "utf-8");
	throwIfAborted(signal);
	const { bom, text } = stripBom(rawContent);

	return {
		normalizedContent: normalizeToLF(text),
		bom,
		originalEnding: detectLineEnding(text),
	};
}

async function executeMultiReplaceMode(
	input: MultiReplaceModeInput,
	cwd: string,
	signal: AbortSignal | undefined,
): Promise<{
	content: Array<{ type: "text"; text: string }>;
	details: RenderedDiff;
}> {
	const absolutePath = resolveToCwd(input.path, cwd);

	return withFileMutationQueue(absolutePath, async () => {
		const { normalizedContent, bom, originalEnding } = await readNormalizedFile(absolutePath, input.path, signal);

		type MatchedEdit = ReplaceEdit & { index: number; matchLength: number };

		const normalizedEdits = input.edits.map((edit) => ({
			oldText: normalizeToLF(edit.oldText),
			newText: normalizeToLF(edit.newText),
		}));

		let baseContent = normalizedContent;
		if (normalizedEdits.some((edit) => fuzzyFindText(normalizedContent, edit.oldText).usedFuzzyMatch)) {
			baseContent = normalizeForFuzzyMatch(normalizedContent);
		}

		const matchedEdits: MatchedEdit[] = [];
		for (const edit of normalizedEdits) {
			if (edit.oldText.length === 0) {
				throw new Error("Edit tool input is invalid. edits[].oldText must not be empty.");
			}

			const matchResult = fuzzyFindText(baseContent, edit.oldText);
			if (!matchResult.found) {
				throw new Error(
					`Could not find the exact text in ${input.path} for one of the edits. Each oldText must match exactly including whitespace and newlines.`,
				);
			}

			const fuzzyContent = normalizeForFuzzyMatch(baseContent);
			const fuzzyOldText = normalizeForFuzzyMatch(edit.oldText);
			const occurrences = fuzzyContent.split(fuzzyOldText).length - 1;
			if (occurrences > 1) {
				throw new Error(
					`Found multiple occurrences of one edits[].oldText block in ${input.path}. Each oldText must be unique in the original file.`,
				);
			}

			matchedEdits.push({
				oldText: edit.oldText,
				newText: edit.newText,
				index: matchResult.index,
				matchLength: matchResult.matchLength,
			});
		}

		matchedEdits.sort((a, b) => a.index - b.index);
		for (let i = 1; i < matchedEdits.length; i++) {
			const previous = matchedEdits[i - 1];
			const current = matchedEdits[i];
			if (previous.index + previous.matchLength > current.index) {
				throw new Error("Edit tool input is invalid. edits must not overlap in the original file.");
			}
		}

		let newContent = baseContent;
		for (let i = matchedEdits.length - 1; i >= 0; i--) {
			const edit = matchedEdits[i];
			newContent = newContent.slice(0, edit.index) + edit.newText + newContent.slice(edit.index + edit.matchLength);
		}

		if (newContent === baseContent) {
			throw new Error(`No changes made to ${input.path}. The replacements produced identical content.`);
		}

		await fsWriteFile(absolutePath, bom + restoreLineEndings(newContent, originalEnding), "utf-8");
		throwIfAborted(signal);
		const diffResult = generateDiffString(baseContent, newContent);

		return {
			content: [{ type: "text", text: `Successfully replaced ${input.edits.length} block(s) in ${input.path}.` }],
			details: diffResult,
		};
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "edit",
		label: "edit",
		description:
			"Edit a single file. Use oldText and newText for one precise replacement. Use edits for multiple precise replacements in the same file. Do not provide both modes at once.",
		parameters: editSchema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const input = params as EditInput;
			const multiReplaceModeInput = getMultiReplaceModeInput(input);
			if (multiReplaceModeInput) {
				return executeMultiReplaceMode(multiReplaceModeInput, ctx.cwd, signal);
			}

			const replaceModeInput = getReplaceModeInput(input);
			if (replaceModeInput) {
				const builtInEdit = createEditTool(ctx.cwd);
				return builtInEdit.execute(toolCallId, replaceModeInput, signal, onUpdate);
			}

			throw new Error("Edit tool input is invalid. Provide either oldText and newText, or edits.");
		},
	});
}
