import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { requirePromptCatalogEntryFromExtension } from "../_shared/prompt-catalog.js";

export default function daemonRunOrchestrationPromptExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => {
		const prompt = event.prompt?.trim() ?? "";
		if (prompt.length === 0 || prompt.startsWith("/")) {
			return;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n\n${requirePromptCatalogEntryFromExtension(import.meta.url, 'runtime/daemon.md')}`,
		};
	});
}
