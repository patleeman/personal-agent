import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface McpCliBinaryState {
  available: boolean;
  command: string;
  path?: string;
  version?: string;
  error?: string;
}

export interface McpCliServerConfig {
  name: string;
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  raw: Record<string, unknown>;
}

export interface McpCliConfigState {
  path: string;
  exists: boolean;
  searchedPaths: string[];
  servers: McpCliServerConfig[];
}

export interface McpCliRunResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface McpCliServerToolSummary {
  name: string;
}

export interface McpCliServerInfo {
  server?: string;
  transport?: string;
  commandLine?: string;
  toolCount?: number;
  tools: McpCliServerToolSummary[];
  rawOutput: string;
}

export interface McpCliToolInfo {
  server?: string;
  tool?: string;
  description?: string;
  schema?: Record<string, unknown>;
  rawOutput: string;
}

export interface McpCliToolCallResult {
  parsed: unknown;
  rawOutput: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfigPath(input: string, cwd: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith('~/')) {
    return join(homedir(), trimmed.slice(2));
  }

  if (trimmed === '~') {
    return homedir();
  }

  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}

function extractServerUrl(command: string | undefined, args: string[]): string | undefined {
  if (!command) {
    return undefined;
  }

  const httpArg = args.find((value) => /^https?:\/\//.test(value));
  if (httpArg) {
    return httpArg;
  }

  return undefined;
}

function parseServerConfig(name: string, value: unknown): McpCliServerConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const command = typeof value.command === 'string' ? value.command : undefined;
  const args = Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === 'string')
    : [];
  const cwd = typeof value.cwd === 'string' ? value.cwd : undefined;
  const url = typeof value.url === 'string' ? value.url : extractServerUrl(command, args);
  const env = isRecord(value.env)
    ? Object.fromEntries(
      Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
    : undefined;

  return {
    name,
    command,
    args,
    cwd,
    url,
    env,
    raw: value,
  };
}

export function resolveMcpCliConfig(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): {
  path: string;
  exists: boolean;
  searchedPaths: string[];
} {
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const env = options.env ?? process.env;
  const explicitPath = options.configPath ?? env.MCP_CONFIG_PATH;

  if (typeof explicitPath === 'string' && explicitPath.trim().length > 0) {
    const resolvedPath = normalizeConfigPath(explicitPath, cwd);
    return {
      path: resolvedPath,
      exists: existsSync(resolvedPath),
      searchedPaths: [resolvedPath],
    };
  }

  const searchedPaths = [
    resolve(cwd, 'mcp_servers.json'),
    join(homedir(), '.mcp_servers.json'),
    join(homedir(), '.config', 'mcp', 'mcp_servers.json'),
  ];
  const existingPath = searchedPaths.find((candidate) => existsSync(candidate));

  return {
    path: existingPath ?? searchedPaths[searchedPaths.length - 1]!,
    exists: existingPath !== undefined,
    searchedPaths,
  };
}

export function readMcpCliConfig(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): McpCliConfigState {
  const resolved = resolveMcpCliConfig(options);

  if (!resolved.exists) {
    return {
      path: resolved.path,
      exists: false,
      searchedPaths: resolved.searchedPaths,
      servers: [],
    };
  }

  const parsed = JSON.parse(readFileSync(resolved.path, 'utf-8')) as unknown;
  const serversRecord = isRecord(parsed) && isRecord(parsed.mcpServers)
    ? parsed.mcpServers
    : {};
  const servers = Object.entries(serversRecord)
    .map(([name, value]) => parseServerConfig(name, value))
    .filter((entry): entry is McpCliServerConfig => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    path: resolved.path,
    exists: true,
    searchedPaths: resolved.searchedPaths,
    servers,
  };
}

export function inspectMcpCliBinary(options: {
  command?: string;
  cwd?: string;
  timeoutMs?: number;
} = {}): McpCliBinaryState {
  const command = options.command?.trim() || 'mcp-cli';
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 5_000;
  const versionResult = spawnSync(command, ['--version'], {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
  });

  if (versionResult.error || versionResult.status !== 0) {
    return {
      available: false,
      command,
      error: versionResult.error?.message
        ?? (versionResult.stderr.trim()
          || versionResult.stdout.trim()
          || `Command exited with code ${versionResult.status ?? -1}`),
    };
  }

  let resolvedPath: string | undefined;
  if (command.includes('/')) {
    resolvedPath = command;
  } else {
    const whichResult = spawnSync('which', [command], {
      cwd,
      encoding: 'utf-8',
      timeout: timeoutMs,
    });
    if (whichResult.status === 0) {
      resolvedPath = whichResult.stdout.trim() || undefined;
    }
  }

  return {
    available: true,
    command,
    path: resolvedPath,
    version: versionResult.stdout.trim(),
  };
}

export function cleanMcpCliStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return false;
      }

      if (trimmed === 'Shutting down...') {
        return false;
      }

      if (trimmed === 'Press Ctrl+C to exit') {
        return false;
      }

      if (trimmed.includes('DOMException [AbortError]: This operation was aborted')) {
        return false;
      }

      return true;
    })
    .join('\n');
}

export function runMcpCli(
  subcommandArgs: string[],
  options: {
    command?: string;
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    withDescriptions?: boolean;
    noDaemon?: boolean;
  } = {},
): McpCliRunResult {
  const command = options.command?.trim() || 'mcp-cli';
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const config = resolveMcpCliConfig({ cwd, configPath: options.configPath, env: options.env });
  const args: string[] = [];

  if (options.withDescriptions) {
    args.push('-d');
  }

  if (config.exists || options.configPath) {
    args.push('-c', config.path);
  }

  args.push(...subcommandArgs);

  const child = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      ...(options.env ?? {}),
      ...(options.noDaemon ? { MCP_NO_DAEMON: '1' } : {}),
    },
  });

  return {
    command,
    args,
    cwd,
    exitCode: child.status ?? (child.error ? -1 : 0),
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? '',
    timedOut: child.error?.name === 'Error' && child.error.message.toLowerCase().includes('timed out'),
    error: child.error?.message,
  };
}

export function parseMcpCliServerInfo(output: string): McpCliServerInfo {
  const lines = output.split(/\r?\n/);
  const tools: McpCliServerToolSummary[] = [];
  let server: string | undefined;
  let transport: string | undefined;
  let commandLine: string | undefined;
  let toolCount: number | undefined;
  let inToolsSection = false;

  for (const line of lines) {
    if (!server) {
      const match = line.match(/^Server:\s+(.+)$/);
      if (match) {
        server = match[1]?.trim();
        continue;
      }
    }

    if (!transport) {
      const match = line.match(/^Transport:\s+(.+)$/);
      if (match) {
        transport = match[1]?.trim();
        continue;
      }
    }

    if (!commandLine) {
      const match = line.match(/^Command:\s+(.+)$/);
      if (match) {
        commandLine = match[1]?.trim();
        continue;
      }
    }

    const toolsHeader = line.match(/^Tools\s+\((\d+)\):$/);
    if (toolsHeader) {
      toolCount = Number.parseInt(toolsHeader[1] ?? '', 10);
      inToolsSection = true;
      continue;
    }

    if (!inToolsSection) {
      continue;
    }

    const toolLine = line.match(/^  ([^\s][^:]*)$/);
    if (toolLine) {
      tools.push({ name: toolLine[1]!.trim() });
    }
  }

  return {
    server,
    transport,
    commandLine,
    toolCount,
    tools,
    rawOutput: output,
  };
}

export function parseMcpCliToolInfo(output: string): McpCliToolInfo {
  const toolMatch = output.match(/^Tool:\s+(.+)$/m);
  const serverMatch = output.match(/^Server:\s+(.+)$/m);
  const descriptionMatch = output.match(/Description:\n([\s\S]*?)\nInput Schema:\n/);
  const schemaHeader = 'Input Schema:\n';
  const schemaIndex = output.indexOf(schemaHeader);
  const schemaText = schemaIndex >= 0 ? output.slice(schemaIndex + schemaHeader.length).trim() : '';
  let schema: Record<string, unknown> | undefined;

  if (schemaText) {
    try {
      const parsed = JSON.parse(schemaText) as unknown;
      if (isRecord(parsed)) {
        schema = parsed;
      }
    } catch {
      schema = undefined;
    }
  }

  return {
    server: serverMatch?.[1]?.trim(),
    tool: toolMatch?.[1]?.trim(),
    description: descriptionMatch?.[1]?.trim(),
    schema,
    rawOutput: output,
  };
}

export function parseMcpCliToolCallResult(output: string): McpCliToolCallResult {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return {
      parsed: null,
      rawOutput: output,
    };
  }

  try {
    return {
      parsed: JSON.parse(trimmed) as unknown,
      rawOutput: output,
    };
  } catch {
    return {
      parsed: trimmed,
      rawOutput: output,
    };
  }
}

export function inspectMcpCliServer(
  server: string,
  options: Parameters<typeof runMcpCli>[1] = {},
): McpCliRunResult & { info: McpCliServerInfo } {
  const result = runMcpCli(['info', server], options);
  return {
    ...result,
    info: parseMcpCliServerInfo(result.stdout),
  };
}

export function inspectMcpCliTool(
  server: string,
  tool: string,
  options: Parameters<typeof runMcpCli>[1] = {},
): McpCliRunResult & { info: McpCliToolInfo } {
  const result = runMcpCli(['info', server, tool], options);
  return {
    ...result,
    info: parseMcpCliToolInfo(result.stdout),
  };
}

export function callMcpCliTool(
  server: string,
  tool: string,
  inputJson: string,
  options: Parameters<typeof runMcpCli>[1] = {},
): McpCliRunResult & { result: McpCliToolCallResult } {
  const result = runMcpCli(['call', server, tool, inputJson], options);
  return {
    ...result,
    result: parseMcpCliToolCallResult(result.stdout),
  };
}
