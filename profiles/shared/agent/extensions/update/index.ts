import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PACKAGE_NAME = "@mariozechner/pi-coding-agent";
const UPDATE_ARGS = ["install", "-g", `${PACKAGE_NAME}@latest`];

function trimOutput(text: string, maxLines = 8): string {
	const lines = text
		.trim()
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (lines.length <= maxLines) {
		return lines.join("\n");
	}

	const hiddenCount = lines.length - maxLines;
	return [...lines.slice(0, maxLines), `... (${hiddenCount} more lines)`].join("\n");
}

export default function updateExtension(pi: ExtensionAPI) {
	pi.registerCommand("update", {
		description: "Update pi to the latest npm release",
		handler: async (_args, ctx) => {
			const beforeVersion = await pi.exec("pi", ["--version"]);
			const before = beforeVersion.code === 0 ? beforeVersion.stdout.trim() : "unknown";

			if (ctx.hasUI) {
				ctx.ui.notify("Updating pi via npm...", "info");
			}

			const result = await pi.exec("npm", UPDATE_ARGS);

			if (result.code !== 0) {
				const errorText = result.stderr.trim() || result.stdout.trim() || "Unknown npm error";
				if (ctx.hasUI) {
					ctx.ui.notify(`Update failed:\n${trimOutput(errorText)}`, "error");
				}
				return;
			}

			const afterVersion = await pi.exec("pi", ["--version"]);
			const after = afterVersion.code === 0 ? afterVersion.stdout.trim() : "unknown";
			const npmOutput = trimOutput(result.stdout);

			const summaryLines = [`pi updated (${before} → ${after}).`, "Restart pi to use the new version."];
			if (npmOutput.length > 0) {
				summaryLines.push("", npmOutput);
			}

			if (ctx.hasUI) {
				ctx.ui.notify(summaryLines.join("\n"), "info");
			}
		},
	});
}
