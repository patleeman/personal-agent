import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// The system prompt template is now rendered at materialization time
// in materializeRuntimeResourcesToAgentDir (resources.ts) with live runtime variables.
// This extension previously registered a before_agent_start handler that
// re-rendered the template every turn, which overwrote Pi's CWD-discovered
// AGENTS.md context files. The handler is no longer needed.
export default function knowledgeBaseExtension(_pi: ExtensionAPI): void {
  // No-op
}
