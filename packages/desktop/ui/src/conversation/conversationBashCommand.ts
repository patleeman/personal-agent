interface WholeLineBashCommand {
  command: string;
  excludeFromContext: boolean;
}

export function parseWholeLineBashCommand(input: string): WholeLineBashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('!') || trimmed.startsWith('!{')) {
    return null;
  }

  const excludeFromContext = trimmed.startsWith('!!');
  const command = (excludeFromContext ? trimmed.slice(2) : trimmed.slice(1)).trim();
  if (!command) {
    return null;
  }

  return {
    command,
    excludeFromContext,
  };
}
