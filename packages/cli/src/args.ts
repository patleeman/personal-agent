export interface ParsedCommand {
  command: string;
  args: string[];
}

const DEFAULT_KNOWN_COMMANDS = ['tui', 'install', 'profile', 'doctor', 'restart', 'update', 'daemon', 'tasks', 'inbox', 'ui', 'memory', 'runs', 'targets', 'sync', 'gateway'];

export function parseCommand(argv: string[], knownCommands: string[] = DEFAULT_KNOWN_COMMANDS): ParsedCommand {
  if (argv.length === 0) {
    return { command: 'help', args: [] };
  }

  const [first, ...rest] = argv;

  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', args: rest };
  }

  if (knownCommands.includes(first)) {
    return { command: first, args: rest };
  }

  return { command: first, args: rest };
}

export function hasOption(args: string[], option: string): boolean {
  return args.includes(option);
}
