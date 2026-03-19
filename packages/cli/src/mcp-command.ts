import {
  authenticateMcpServer,
  callMcpTool,
  clearMcpServerAuth,
  grepMcpTools,
  inspectMcpServer,
  inspectMcpTool,
  listMcpCatalog,
  type McpServerConfig,
} from '@personal-agent/core';
import { stdin as input } from 'node:process';
import { bullet, dim, keyValue, section, success, warning as warningText } from './ui.js';

function mcpUsageText(): string {
  return 'Usage: pa mcp [list|info|grep|call|auth|logout|help] [args...]';
}

function printMcpHelp(): void {
  console.log(section('MCP commands'));
  console.log('');
  console.log(`Usage: pa mcp [list|info|grep|call|auth|logout|help] [args...]

Commands:
  list [-d|--with-descriptions] [-c|--config <path>] [--json]
                                  List configured MCP servers and tools
  info <server> [tool] [-c|--config <path>] [--json]
                                  Inspect one server or tool
  grep <pattern> [-d|--with-descriptions] [-c|--config <path>] [--json]
                                  Search tools by glob pattern (* supported)
  call <server> <tool> [json] [-c|--config <path>] [--json]
                                  Call one MCP tool (reads stdin if json is omitted)
  auth <server> [-c|--config <path>] [--json]
                                  Trigger OAuth / validate connectivity for one server
  logout <server> [-c|--config <path>]
                                  Clear stored OAuth state for one remote server
  help                            Show MCP help

Examples:
  pa mcp
  pa mcp list -d
  pa mcp info atlassian
  pa mcp info atlassian getConfluencePage
  pa mcp info atlassian/getConfluencePage
  pa mcp grep '*jira*'
  pa mcp call atlassian getAccessibleAtlassianResources '{}'
  echo '{"query":"datadog"}' | pa mcp call atlassian searchConfluenceUsingCql
  pa mcp auth slack
  pa mcp logout slack
`);
}

function commandLineForServer(server: McpServerConfig): string | undefined {
  if (server.command) {
    return [server.command, ...server.args].join(' ');
  }

  return server.url;
}

function parseCommonOptions(args: string[]): {
  positional: string[];
  configPath?: string;
  json: boolean;
  withDescriptions: boolean;
} {
  const positional: string[] = [];
  let configPath: string | undefined;
  let json = false;
  let withDescriptions = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--with-descriptions' || arg === '-d') {
      withDescriptions = true;
      continue;
    }

    if (arg === '--config' || arg === '-c') {
      configPath = args[index + 1];
      index += 1;
      continue;
    }

    positional.push(arg);
  }

  return {
    positional,
    configPath,
    json,
    withDescriptions,
  };
}

function splitServerTool(target: string, maybeTool?: string): { server: string; tool?: string } {
  if (maybeTool) {
    return { server: target, tool: maybeTool };
  }

  const slashIndex = target.indexOf('/');
  if (slashIndex < 0) {
    return { server: target };
  }

  return {
    server: target.slice(0, slashIndex),
    tool: target.slice(slashIndex + 1),
  };
}

async function readToolInput(raw: string | undefined): Promise<unknown> {
  if (raw && raw.trim().length > 0) {
    return JSON.parse(raw);
  }

  if (input.isTTY) {
    return {};
  }

  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  const content = Buffer.concat(chunks).toString('utf-8').trim();
  if (!content) {
    return {};
  }

  return JSON.parse(content);
}

function printConfiguredServers(configPath: string, servers: McpServerConfig[]): void {
  console.log(keyValue('Config', configPath));
  console.log(keyValue('Servers', servers.length));

  if (servers.length === 0) {
    console.log(dim('No MCP servers are configured.'));
    return;
  }

  for (const server of servers) {
    console.log('');
    console.log(bullet(`${server.name} (${server.transport})`));
    const commandLine = commandLineForServer(server);
    if (commandLine) {
      console.log(keyValue('Command', commandLine, 4));
    }
    if (server.cwd) {
      console.log(keyValue('cwd', server.cwd, 4));
    }
    if (server.url) {
      console.log(keyValue('URL', server.url, 4));
    }
  }
}

export async function mcpCommand(args: string[]): Promise<number> {
  const [subcommand = 'list', ...rest] = args;

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printMcpHelp();
    return 0;
  }

  if (subcommand === 'list') {
    const options = parseCommonOptions(rest);
    if (options.positional.length > 0) {
      throw new Error(mcpUsageText());
    }

    const catalog = await listMcpCatalog({
      configPath: options.configPath,
      withDescriptions: options.withDescriptions,
      log: (message) => console.error(message),
    });

    if (options.json) {
      console.log(JSON.stringify(catalog, null, 2));
      return catalog.servers.some((server) => server.error) ? 1 : 0;
    }

    console.log(section('MCP servers'));
    printConfiguredServers(catalog.config.path, catalog.config.servers);

    for (const server of catalog.servers) {
      console.log('');
      console.log(section(server.name));
      if (server.info) {
        if (server.info.tools.length === 0) {
          console.log(dim('No tools returned.'));
          continue;
        }

        for (const tool of server.info.tools) {
          const description = options.withDescriptions && tool.description ? ` — ${tool.description}` : '';
          console.log(bullet(`${tool.name}${description}`));
        }
      } else {
        console.log(warningText(server.error ?? 'Unknown MCP error'));
      }
    }

    return catalog.servers.some((server) => server.error) ? 1 : 0;
  }

  if (subcommand === 'info') {
    const options = parseCommonOptions(rest);
    if (options.positional.length < 1 || options.positional.length > 2) {
      throw new Error('Usage: pa mcp info <server> [tool] [-c|--config <path>] [--json]');
    }

    const target = splitServerTool(options.positional[0] as string, options.positional[1]);
    if (target.tool) {
      const result = await inspectMcpTool(target.server, target.tool, {
        configPath: options.configPath,
        log: (message) => console.error(message),
      });

      if (options.json) {
        console.log(JSON.stringify(result.data ?? { error: result.error, stderr: result.stderr }, null, 2));
        return result.exitCode === 0 ? 0 : 1;
      }

      if (!result.data) {
        throw new Error((result.error ?? result.stderr) || `Failed to inspect ${target.server}/${target.tool}`);
      }

      process.stdout.write(result.data.rawOutput);
      return 0;
    }

    const result = await inspectMcpServer(target.server, {
      configPath: options.configPath,
      withDescriptions: options.withDescriptions,
      log: (message) => console.error(message),
    });

    if (options.json) {
      console.log(JSON.stringify(result.data ?? { error: result.error, stderr: result.stderr }, null, 2));
      return result.exitCode === 0 ? 0 : 1;
    }

    if (!result.data) {
      throw new Error((result.error ?? result.stderr) || `Failed to inspect ${target.server}`);
    }

    process.stdout.write(result.data.rawOutput);
    return 0;
  }

  if (subcommand === 'grep') {
    const options = parseCommonOptions(rest);
    if (options.positional.length !== 1) {
      throw new Error('Usage: pa mcp grep <pattern> [-d|--with-descriptions] [-c|--config <path>] [--json]');
    }

    const result = await grepMcpTools(options.positional[0] as string, {
      configPath: options.configPath,
      withDescriptions: options.withDescriptions,
      log: (message) => console.error(message),
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return result.errors.length > 0 ? 1 : 0;
    }

    console.log(section(`MCP matches: ${options.positional[0]}`));
    if (result.matches.length === 0) {
      console.log(dim('No tools matched.'));
    } else {
      for (const match of result.matches) {
        const description = options.withDescriptions && match.tool.description ? ` — ${match.tool.description}` : '';
        console.log(bullet(`${match.server}/${match.tool.name}${description}`));
      }
    }

    for (const error of result.errors) {
      console.log('');
      console.log(warningText(`${error.server}: ${error.error}`));
    }

    return result.errors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'call') {
    const options = parseCommonOptions(rest);
    if (options.positional.length < 2 || options.positional.length > 3) {
      throw new Error('Usage: pa mcp call <server> <tool> [json] [-c|--config <path>] [--json]');
    }

    const [serverOrPath, toolMaybe, jsonInput] = options.positional;
    const target = splitServerTool(serverOrPath as string, toolMaybe as string | undefined);
    if (!target.tool) {
      throw new Error('Usage: pa mcp call <server> <tool> [json] [-c|--config <path>] [--json]');
    }

    const parsedInput = await readToolInput(jsonInput as string | undefined);
    const result = await callMcpTool(target.server, target.tool, parsedInput, {
      configPath: options.configPath,
      log: (message) => console.error(message),
    });

    if (options.json || result.data) {
      process.stdout.write(result.data?.rawOutput ?? `${JSON.stringify({ error: result.error, stderr: result.stderr }, null, 2)}\n`);
    }

    return result.exitCode === 0 ? 0 : 1;
  }

  if (subcommand === 'auth') {
    const options = parseCommonOptions(rest);
    if (options.positional.length !== 1) {
      throw new Error('Usage: pa mcp auth <server> [-c|--config <path>] [--json]');
    }

    const result = await authenticateMcpServer(options.positional[0] as string, {
      configPath: options.configPath,
      log: (message) => console.error(message),
    });

    if (options.json) {
      console.log(JSON.stringify(result.data ?? { error: result.error, stderr: result.stderr }, null, 2));
      return result.exitCode === 0 ? 0 : 1;
    }

    if (!result.data) {
      throw new Error((result.error ?? result.stderr) || `Failed to authenticate ${options.positional[0]}`);
    }

    console.log(success('MCP auth ready', `${options.positional[0]} (${result.data.toolCount ?? result.data.tools.length} tools)`));
    return 0;
  }

  if (subcommand === 'logout') {
    const options = parseCommonOptions(rest);
    if (options.positional.length !== 1 || options.json) {
      throw new Error('Usage: pa mcp logout <server> [-c|--config <path>]');
    }

    await clearMcpServerAuth(options.positional[0] as string, {
      configPath: options.configPath,
    });
    console.log(success('Cleared MCP auth', options.positional[0] as string));
    return 0;
  }

  throw new Error(mcpUsageText());
}
