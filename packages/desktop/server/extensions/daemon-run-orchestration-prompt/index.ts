import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// No-op. System prompt modifications are handled exclusively through
// file-based layers (SYSTEM.md, APPEND_SYSTEM.md, AGENTS.md from CWD).
// This previously registered a before_agent_start handler that returned
// { systemPrompt } which broke Pi's system prompt assembly pipeline.
export default function daemonRunOrchestrationPromptExtension(_pi: ExtensionAPI): void {
  // No-op
}
