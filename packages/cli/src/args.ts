export type CliCommand = 'run' | 'profile' | 'doctor' | 'daemon' | 'help';

export interface ParsedCommand {
  command: CliCommand;
  args: string[];
}

export interface ProfileFlagResult {
  profile?: string;
  remainingArgs: string[];
}

export function parseCommand(argv: string[]): ParsedCommand {
  if (argv.length === 0) {
    return { command: 'run', args: [] };
  }

  const [first, ...rest] = argv;

  if (first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help', args: rest };
  }

  if (first === 'run' || first === 'profile' || first === 'doctor' || first === 'daemon') {
    return { command: first, args: rest };
  }

  return { command: 'run', args: argv };
}

export function extractProfileFlag(args: string[]): ProfileFlagResult {
  const remainingArgs: string[] = [];
  let profile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--profile') {
      const value = args[i + 1];
      if (!value) {
        throw new Error('--profile requires a value');
      }
      profile = value;
      i += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  return { profile, remainingArgs };
}

export function hasOption(args: string[], option: string): boolean {
  return args.includes(option);
}
