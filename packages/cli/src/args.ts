export interface ParsedCommand {
  command: string;
  args: string[];
}

const DEFAULT_KNOWN_COMMANDS = ['tui', 'profile', 'doctor', 'daemon', 'memory'];

export function parseCommand(argv: string[], knownCommands: string[] = DEFAULT_KNOWN_COMMANDS): ParsedCommand {
  if (argv.length === 0) {
    return { command: 'tui', args: [] };
  }

  const [first, ...rest] = argv;

  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', args: rest };
  }

  if (knownCommands.includes(first)) {
    return { command: first, args: rest };
  }

  return { command: 'tui', args: argv };
}

export function hasOption(args: string[], option: string): boolean {
  return args.includes(option);
}
