import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { renderSystemPromptTemplate } from "@personal-agent/core";

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function daemonRunOrchestrationPromptExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    const prompt = event.prompt?.trim() ?? "";
    if (prompt.length === 0 || prompt.startsWith("/")) {
      return;
    }

    const rendered = renderSystemPromptTemplate({
      current_date: formatDate(new Date()),
    });

    return {
      systemPrompt: rendered,
    };
  });
}
