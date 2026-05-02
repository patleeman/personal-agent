import { Type } from '@sinclair/typebox';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  authenticateMcpServer,
  callMcpTool,
  clearMcpServerAuth,
  grepMcpTools,
  inspectMcpServer,
  inspectMcpTool,
  listMcpCatalog,
} from '@personal-agent/core';

const MCP_ACTION_VALUES = ['list', 'info', 'grep', 'call', 'auth', 'logout'] as const;

type McpAction = (typeof MCP_ACTION_VALUES)[number];

const McpToolParams = Type.Object({
  action: Type.Union(MCP_ACTION_VALUES.map((value) => Type.Literal(value)), {
    description: 'MCP operation to perform.',
  }),
  server: Type.Optional(Type.String({
    description: 'MCP server name. Required for info, grep, call, auth, logout.',
  })),
  tool: Type.Optional(Type.String({
    description: 'Tool name within the server. Used with info and call actions.',
  })),
  pattern: Type.Optional(Type.String({
    description: 'Glob pattern to search tools. Used with grep action. Supports * wildcards.',
  })),
  arguments: Type.Optional(Type.String({
    description: 'JSON string of arguments to pass to the tool. Used with call action. Example: \'{"query":"hello"}\'',
  })),
  probe: Type.Optional(Type.Boolean({
    description: 'When listing servers, whether to fetch and display their tools. Default false.',
  })),
});

function validateMcpString(value: string | undefined, label: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

interface McpToolActionHandler {
  (params: typeof McpToolParams.static, log: (message: string) => void): Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    details?: Record<string, unknown>;
  }>;
}

type McpToolHandler = (params: typeof McpToolParams.static, log: (message: string) => void) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  details?: Record<string, unknown>;
}>;

export function createMcpAgentExtension(): ExtensionAPI {
  return (api: ExtensionAPI) => {
    api.registerTool({
      name: 'mcp',
      description: 'Inspect and call MCP (Model Context Protocol) servers. Supports listing configured servers, inspecting tools, calling tools, searching tools, and managing OAuth authentication.',
      parameters: McpToolParams,
      handler: (async (rawParams: unknown) => {
        const params = rawParams as typeof McpToolParams.static;
        const stderrLogs: string[] = [];

        const log = (message: string) => {
          stderrLogs.push(message);
        };

        const commonOptions = {
          log,
        };

        const action = params.action as McpAction;
        const server = params.server?.trim();
        const tool = params.tool?.trim();

        try {
          switch (action) {
            case 'list': {
              const catalog = await listMcpCatalog({
                ...commonOptions,
                probe: params.probe ?? false,
                withDescriptions: params.probe ?? false,
              });

              let output = `MCP servers (${catalog.config.path}):\n`;

              if (catalog.servers.length === 0) {
                output += 'No MCP servers are configured.\n';
              } else {
                for (const entry of catalog.servers) {
                  output += `\n  ${entry.name}`;
                  if (entry.info) {
                    output += ` (${entry.info.transport ?? 'stdio'})`;
                    if (entry.info.toolCount !== undefined) {
                      output += ` — ${entry.info.toolCount} tools`;
                    }
                    output += '\n';
                    if (entry.info.tools.length > 0) {
                      for (const mcpTool of entry.info.tools.slice(0, 50)) {
                        output += `    - ${mcpTool.name}`;
                        if (mcpTool.description) {
                          output += `: ${mcpTool.description}`;
                        }
                        output += '\n';
                      }
                      if (entry.info.tools.length > 50) {
                        output += `    ... and ${entry.info.tools.length - 50} more\n`;
                      }
                    }
                  } else if (entry.error) {
                    output += ` — error: ${entry.error}\n`;
                  } else {
                    output += '\n';
                  }
                }
              }

              return {
                content: [{ type: 'text', text: output }],
                details: {
                  action: 'list',
                  serverCount: catalog.servers.length,
                },
              };
            }

            case 'info': {
              const serverName = validateMcpString(server, 'Server name');

              if (tool) {
                const result = await inspectMcpTool(serverName, tool, commonOptions);
                if (!result.data) {
                  throw new Error(result.error ?? result.stderr ?? `Failed to inspect ${serverName}/${tool}`);
                }

                let output = `Tool: ${result.data.server}/${result.data.tool}\n`;
                if (result.data.description) {
                  output += `Description: ${result.data.description}\n`;
                }
                if (result.data.schema && Object.keys(result.data.schema).length > 0) {
                  output += `Input schema:\n${JSON.stringify(result.data.schema, null, 2)}\n`;
                }

                return {
                  content: [{ type: 'text', text: output }],
                  details: {
                    action: 'info',
                    server: serverName,
                    tool,
                  },
                };
              }

              const result = await inspectMcpServer(serverName, commonOptions);
              if (!result.data) {
                throw new Error(result.error ?? result.stderr ?? `Failed to inspect ${serverName}`);
              }

              let output = `Server: ${result.data.server}\n`;
              output += `Transport: ${result.data.transport ?? 'stdio'}\n`;
              if (result.data.commandLine) {
                output += `Command: ${result.data.commandLine}\n`;
              }
              output += `\nTools (${result.data.toolCount ?? result.data.tools.length}):\n`;
              for (const mcpTool of result.data.tools) {
                output += `  - ${mcpTool.name}`;
                if (mcpTool.description) {
                  output += `: ${mcpTool.description}`;
                }
                output += '\n';
              }

              return {
                content: [{ type: 'text', text: output }],
                details: {
                  action: 'info',
                  server: serverName,
                  toolCount: result.data.tools.length,
                },
              };
            }

            case 'grep': {
              const grepPattern = validateMcpString(params.pattern, 'Pattern');
              const result = await grepMcpTools(grepPattern, {
                ...commonOptions,
                withDescriptions: true,
              });

              if (result.matches.length === 0) {
                return {
                  content: [{ type: 'text', text: `No tools matched pattern: ${grepPattern}` }],
                  details: {
                    action: 'grep',
                    pattern: grepPattern,
                    matchCount: 0,
                  },
                };
              }

              let output = `Matches for "${grepPattern}" (${result.matches.length}):\n`;
              for (const match of result.matches) {
                output += `\n  ${match.server}/${match.tool.name}`;
                if (match.tool.description) {
                  output += ` — ${match.tool.description}`;
                }
              }
              output += '\n';

              if (result.errors.length > 0) {
                output += '\nErrors:\n';
                for (const err of result.errors) {
                  output += `  ${err.server}: ${err.error}\n`;
                }
              }

              return {
                content: [{ type: 'text', text: output }],
                details: {
                  action: 'grep',
                  pattern: grepPattern,
                  matchCount: result.matches.length,
                  errorCount: result.errors.length,
                },
              };
            }

            case 'call': {
              const callServer = validateMcpString(server, 'Server name');
              const callTool = validateMcpString(tool, 'Tool name');
              let parsedInput: unknown = {};

              if (params.arguments) {
                try {
                  parsedInput = JSON.parse(params.arguments);
                } catch {
                  throw new Error(`Invalid JSON in arguments: ${params.arguments}`);
                }
              }

              const result = await callMcpTool(callServer, callTool, parsedInput, commonOptions);
              if (result.data) {
                const formatted = typeof result.data.parsed === 'object'
                  ? JSON.stringify(result.data.parsed, null, 2)
                  : String(result.data.parsed);

                return {
                  content: [{ type: 'text', text: formatted }],
                  details: {
                    action: 'call',
                    server: callServer,
                    tool: callTool,
                  },
                };
              }

              throw new Error(result.error ?? result.stderr ?? `Failed to call ${callServer}/${callTool}`);
            }

            case 'auth': {
              const authServer = validateMcpString(server, 'Server name');
              const result = await authenticateMcpServer(authServer, commonOptions);

              if (!result.data) {
                throw new Error(result.error ?? result.stderr ?? `Failed to authenticate ${authServer}`);
              }

              return {
                content: [{ type: 'text', text: `Successfully authenticated ${authServer} (${result.data.toolCount} tools available)` }],
                details: {
                  action: 'auth',
                  server: authServer,
                  toolCount: result.data.toolCount,
                },
              };
            }

            case 'logout': {
              const logoutServer = validateMcpString(server, 'Server name');
              await clearMcpServerAuth(logoutServer, commonOptions);

              return {
                content: [{ type: 'text', text: `Cleared stored OAuth state for ${logoutServer}` }],
                details: {
                  action: 'logout',
                  server: logoutServer,
                },
              };
            }

            default:
              throw new Error(`Unsupported MCP action: ${String(action)}`);
          }
        } catch (error) {
          return {
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            details: {
              action: params.action,
            },
          };
        }
      }) as (params: unknown) => Promise<{
        content: Array<{ type: 'text'; text: string }>;
        isError?: boolean;
        details?: Record<string, unknown>;
      }>,
    });

    return api;
  };
}
