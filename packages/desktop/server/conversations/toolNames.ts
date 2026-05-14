export function normalizeTranscriptToolName(toolName: string): string {
  return toolName === 'shell' || toolName === '_shell' ? 'bash' : toolName;
}
