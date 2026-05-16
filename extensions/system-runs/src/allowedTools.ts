export const COMMON_AGENT_TOOL_NAMES = [
  'bash',
  'read',
  'edit',
  'write',
  'artifact',
  'scheduled_task',
  'deferred_resume',
  'checkpoint',
  'extension_manager',
  'probe_image',
  'web_fetch',
  'exa_search',
  'duckduckgo_search',
  'set_goal',
  'update_goal',
  'browser_snapshot',
  'browser_cdp',
  'browser_screenshot',
  'ask_user_question',
  'conversation_inspect',
  'set_conversation_title',
  'change_working_directory',
  'mcp',
  'background_command',
  'subagent',
].join(', ');

const SHELL_COMMAND_TOOL_HINTS = new Map<string, string>([
  ['rg', 'Use allowedTools: ["bash"] and run rg inside bash.'],
  ['grep', 'Use allowedTools: ["bash"] and run grep inside bash.'],
  ['find', 'Use allowedTools: ["bash"] and run find inside bash.'],
  ['ls', 'Use allowedTools: ["bash"] and run ls inside bash.'],
  ['cat', 'Use allowedTools: ["bash"] and use read for files or cat inside bash.'],
  ['sed', 'Use allowedTools: ["bash"] and run sed inside bash.'],
]);

export const ALLOWED_TOOLS_DESCRIPTION = `Optional comma-separated string or array of actual agent tool names. Common names: ${COMMON_AGENT_TOOL_NAMES}. Shell commands like rg/grep/find/ls are not tool names; allow bash instead.`;

export function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const rawTools = Array.isArray(value) ? value : String(value).split(',');
  const tools = rawTools.map((t) => String(t).trim()).filter((t) => t.length > 0);
  for (const tool of tools) {
    const hint = SHELL_COMMAND_TOOL_HINTS.get(tool);
    if (hint) {
      throw new Error(`allowedTools contains shell command "${tool}", but allowedTools only accepts agent tool names. ${hint}`);
    }
  }
  return tools.length > 0 ? tools : undefined;
}
