import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deleteConfigFile } from './mcp-auth-storage.js';
import { getMcpServerUrlHash, openRemoteMcpClient, resolveCallbackPort } from './mcp-oauth.js';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeConfigPath(input, cwd) {
    const trimmed = input.trim();
    if (trimmed === '~') {
        return homedir();
    }
    if (trimmed.startsWith('~/')) {
        return join(homedir(), trimmed.slice(2));
    }
    return isAbsolute(trimmed) ? resolve(trimmed) : resolve(cwd, trimmed);
}
function normalizeEnvMap(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const entries = Object.entries(value).filter((entry) => typeof entry[1] === 'string');
    if (entries.length === 0) {
        return undefined;
    }
    return Object.fromEntries(entries);
}
function mergeStringEnv(...sources) {
    const merged = {};
    for (const source of sources) {
        if (!source) {
            continue;
        }
        for (const [key, value] of Object.entries(source)) {
            if (typeof value === 'string') {
                merged[key] = value;
            }
        }
    }
    return merged;
}
function looksLikeMcpRemotePackage(arg) {
    return arg === 'mcp-remote' || arg.startsWith('mcp-remote@');
}
function looksLikeMcpRemoteCommand(command) {
    const base = command.split('/').pop() ?? command;
    return base === 'mcp-remote';
}
function parseJsonArg(input, baseDir) {
    if (!input) {
        return undefined;
    }
    if (input.startsWith('@')) {
        const filePath = normalizeConfigPath(input.slice(1), baseDir);
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    return JSON.parse(input);
}
function synthesizeStaticClientInfo(input) {
    if (input.clientInfo) {
        return input.clientInfo;
    }
    if (!input.clientId) {
        return undefined;
    }
    const callbackHost = input.callbackHost ?? 'localhost';
    const callbackPort = input.callbackPort ?? 3334;
    const callbackPath = input.callbackPath ?? '/oauth/callback';
    const redirectUrl = `http://${callbackHost}:${callbackPort}${callbackPath}`;
    return {
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uris: [redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: input.clientSecret ? 'client_secret_post' : 'none',
        client_name: typeof input.clientMetadata?.client_name === 'string' ? input.clientMetadata.client_name : 'Personal Agent MCP Client',
        client_uri: typeof input.clientMetadata?.client_uri === 'string' ? input.clientMetadata.client_uri : 'https://github.com/patrickc/pa',
        scope: typeof input.clientMetadata?.scope === 'string' ? input.clientMetadata.scope : undefined,
        software_id: typeof input.clientMetadata?.software_id === 'string' ? input.clientMetadata.software_id : undefined,
        software_version: typeof input.clientMetadata?.software_version === 'string' ? input.clientMetadata.software_version : undefined,
    };
}
function parseMcpRemoteArgs(command, args, baseDir) {
    const commandIsRemote = command ? looksLikeMcpRemoteCommand(command) : false;
    const packageIndex = commandIsRemote ? -1 : args.findIndex(looksLikeMcpRemotePackage);
    if (!commandIsRemote && packageIndex < 0) {
        return null;
    }
    const remoteArgs = commandIsRemote ? [...args] : args.slice(packageIndex + 1);
    let url;
    let callbackPort;
    const headers = {};
    const ignoreTools = [];
    let authorizeResource;
    let callbackHost;
    let transportStrategy;
    let authTimeoutMs;
    let oauthClientMetadata;
    let oauthClientInfo;
    for (let index = 0; index < remoteArgs.length; index += 1) {
        const arg = remoteArgs[index];
        if (!url && /^https?:\/\//.test(arg)) {
            url = arg;
            const next = remoteArgs[index + 1];
            if (next && /^\d+$/.test(next)) {
                callbackPort = Number.parseInt(next, 10);
                index += 1;
            }
            continue;
        }
        if (arg === '--header') {
            const header = remoteArgs[index + 1];
            if (header) {
                const match = header.match(/^([^:]+):\s*(.*)$/);
                if (match) {
                    headers[match[1]] = match[2];
                }
                index += 1;
            }
            continue;
        }
        if (arg === '--resource') {
            authorizeResource = remoteArgs[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--host') {
            callbackHost = remoteArgs[index + 1];
            index += 1;
            continue;
        }
        if (arg === '--transport') {
            const value = remoteArgs[index + 1];
            if (value === 'sse-only' || value === 'http-only' || value === 'sse-first' || value === 'http-first') {
                transportStrategy = value;
            }
            index += 1;
            continue;
        }
        if (arg === '--auth-timeout') {
            const value = remoteArgs[index + 1];
            if (value && /^\d+$/.test(value)) {
                authTimeoutMs = Number.parseInt(value, 10) * 1000;
            }
            index += 1;
            continue;
        }
        if (arg === '--ignore-tool') {
            const value = remoteArgs[index + 1];
            if (value) {
                ignoreTools.push(value);
            }
            index += 1;
            continue;
        }
        if (arg === '--static-oauth-client-metadata') {
            oauthClientMetadata = parseJsonArg(remoteArgs[index + 1], baseDir);
            index += 1;
            continue;
        }
        if (arg === '--static-oauth-client-info') {
            oauthClientInfo = parseJsonArg(remoteArgs[index + 1], baseDir);
            index += 1;
            continue;
        }
    }
    if (!url) {
        return null;
    }
    return {
        transport: 'remote',
        url,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        authorizeResource,
        callbackHost,
        callbackPort,
        callbackPath: '/oauth/callback',
        transportStrategy,
        ignoreTools: ignoreTools.length > 0 ? ignoreTools : undefined,
        authTimeoutMs,
        oauthClientMetadata,
        oauthClientInfo,
    };
}
function parseRemoteServerConfig(name, value, baseDir) {
    const url = typeof value.url === 'string' ? value.url : undefined;
    if (!url) {
        return null;
    }
    const callback = isRecord(value.callback) ? value.callback : undefined;
    const oauth = isRecord(value.oauth) ? value.oauth : undefined;
    const callbackHost = typeof callback?.host === 'string' ? callback.host : typeof value.callbackHost === 'string' ? value.callbackHost : undefined;
    const callbackPath = typeof callback?.path === 'string' ? callback.path : typeof value.callbackPath === 'string' ? value.callbackPath : undefined;
    const callbackPort = typeof callback?.port === 'number' ? callback.port : typeof value.callbackPort === 'number' ? value.callbackPort : undefined;
    const oauthClientMetadata = parseJsonArg(typeof oauth?.clientMetadataPath === 'string' ? `@${oauth.clientMetadataPath}` : undefined, baseDir) ?? (isRecord(oauth?.clientMetadata) ? oauth.clientMetadata : undefined);
    const explicitClientInfo = parseJsonArg(typeof oauth?.clientInfoPath === 'string' ? `@${oauth.clientInfoPath}` : undefined, baseDir) ??
        (isRecord(oauth?.clientInfo) ? oauth.clientInfo : undefined);
    const oauthClientInfo = synthesizeStaticClientInfo({
        clientId: typeof oauth?.clientId === 'string' ? oauth.clientId : undefined,
        clientSecret: typeof oauth?.clientSecret === 'string' ? oauth.clientSecret : undefined,
        clientInfo: explicitClientInfo,
        clientMetadata: oauthClientMetadata,
        callbackHost,
        callbackPort,
        callbackPath,
    });
    const headers = normalizeEnvMap(value.headers);
    const ignoreTools = Array.isArray(value.ignoreTools)
        ? value.ignoreTools.filter((entry) => typeof entry === 'string')
        : undefined;
    return {
        name,
        transport: 'remote',
        args: [],
        url,
        env: normalizeEnvMap(value.env) ?? normalizeEnvMap(value.environment),
        headers,
        authorizeResource: typeof value.authorizeResource === 'string'
            ? value.authorizeResource
            : typeof oauth?.resource === 'string'
                ? oauth.resource
                : undefined,
        callbackHost,
        callbackPort,
        callbackPath,
        transportStrategy: value.transport === 'sse-only' ||
            value.transport === 'http-only' ||
            value.transport === 'sse-first' ||
            value.transport === 'http-first'
            ? value.transport
            : undefined,
        ignoreTools,
        authTimeoutMs: typeof value.authTimeoutMs === 'number'
            ? value.authTimeoutMs
            : typeof value.authTimeoutSeconds === 'number'
                ? value.authTimeoutSeconds * 1000
                : undefined,
        oauthClientMetadata,
        oauthClientInfo,
        raw: value,
    };
}
function parseServerConfig(name, value, baseDir) {
    if (!isRecord(value)) {
        return null;
    }
    if (value.type === 'remote') {
        return parseRemoteServerConfig(name, value, baseDir);
    }
    const command = typeof value.command === 'string' ? value.command : undefined;
    const args = Array.isArray(value.args) ? value.args.filter((entry) => typeof entry === 'string') : [];
    const cwd = typeof value.cwd === 'string' ? value.cwd : undefined;
    const env = normalizeEnvMap(value.env) ?? normalizeEnvMap(value.environment);
    const remoteConfig = parseMcpRemoteArgs(command, args, baseDir);
    if (remoteConfig) {
        return {
            name,
            command,
            args,
            cwd,
            env,
            raw: value,
            ...remoteConfig,
        };
    }
    return {
        name,
        transport: 'stdio',
        command,
        args,
        cwd,
        env,
        url: typeof value.url === 'string' ? value.url : undefined,
        raw: value,
    };
}
export function resolveMcpConfig(options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const explicitPath = options.configPath ?? env.MCP_CONFIG_PATH;
    if (typeof explicitPath === 'string' && explicitPath.trim().length > 0) {
        const path = normalizeConfigPath(explicitPath, cwd);
        let exists = true;
        try {
            readFileSync(path, 'utf-8');
        }
        catch {
            exists = false;
        }
        return {
            path,
            exists,
            searchedPaths: [path],
        };
    }
    const searchedPaths = [
        resolve(cwd, 'mcp_servers.json'),
        join(homedir(), '.mcp_servers.json'),
        join(homedir(), '.config', 'mcp', 'mcp_servers.json'),
    ];
    const existingPath = searchedPaths.find((candidate) => {
        try {
            readFileSync(candidate, 'utf-8');
            return true;
        }
        catch {
            return false;
        }
    });
    return {
        path: existingPath ?? searchedPaths[searchedPaths.length - 1],
        exists: existingPath !== undefined,
        searchedPaths,
    };
}
export function readMcpConfigDocument(options) {
    if (!options.exists) {
        return {
            path: options.path,
            exists: false,
            searchedPaths: options.searchedPaths,
            servers: [],
        };
    }
    const serversRecord = isRecord(options.document) && isRecord(options.document.mcpServers) ? options.document.mcpServers : {};
    const configDir = dirname(options.path);
    const servers = Object.entries(serversRecord)
        .map(([name, value]) => parseServerConfig(name, value, configDir))
        .filter((entry) => entry !== null)
        .sort((left, right) => left.name.localeCompare(right.name));
    return {
        path: options.path,
        exists: true,
        searchedPaths: options.searchedPaths,
        servers,
    };
}
export function readMcpConfig(options = {}) {
    const resolved = resolveMcpConfig(options);
    if (!resolved.exists) {
        return {
            path: resolved.path,
            exists: false,
            searchedPaths: resolved.searchedPaths,
            servers: [],
        };
    }
    const parsed = JSON.parse(readFileSync(resolved.path, 'utf-8'));
    return readMcpConfigDocument({
        path: resolved.path,
        exists: true,
        searchedPaths: resolved.searchedPaths,
        document: parsed,
    });
}
function describeSchemaType(schema) {
    if (!isRecord(schema)) {
        return 'unknown';
    }
    if (typeof schema.type === 'string') {
        return schema.type;
    }
    if (Array.isArray(schema.type)) {
        return schema.type.filter((entry) => typeof entry === 'string').join('|') || 'unknown';
    }
    if (Array.isArray(schema.anyOf)) {
        return 'anyOf';
    }
    if (Array.isArray(schema.oneOf)) {
        return 'oneOf';
    }
    return 'unknown';
}
function formatMcpServerOutput(input) {
    const lines = [`Server: ${input.server}`, `Transport: ${input.transport}`];
    if (input.commandLine) {
        lines.push(`Command: ${input.commandLine}`);
    }
    lines.push('');
    lines.push(`Tools (${input.tools.length}):`);
    for (const tool of input.tools) {
        lines.push(`  ${tool.name}`);
        if (input.withDescriptions && tool.description) {
            lines.push(`    Description: ${tool.description}`);
        }
        const schema = isRecord(tool.inputSchema) ? tool.inputSchema : undefined;
        const properties = isRecord(schema?.properties) ? schema.properties : {};
        const required = Array.isArray(schema?.required) ? schema.required.filter((entry) => typeof entry === 'string') : [];
        if (Object.keys(properties).length > 0) {
            lines.push('    Parameters:');
            for (const [name, propertySchema] of Object.entries(properties)) {
                const requiredSuffix = required.includes(name) ? ', required' : '';
                lines.push(`      • ${name} (${describeSchemaType(propertySchema)}${requiredSuffix})`);
            }
        }
    }
    return `${lines.join('\n')}\n`;
}
function formatMcpToolOutput(input) {
    const lines = [
        `Tool: ${input.tool}`,
        `Server: ${input.server}`,
        '',
        'Description:',
        input.description ? `  ${input.description}` : '  ',
        '',
        'Input Schema:',
        JSON.stringify(input.schema ?? {}, null, 2),
    ];
    return `${lines.join('\n')}\n`;
}
function patternToRegex(pattern) {
    const escaped = pattern
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${escaped}$`, 'i');
}
function includeTool(ignorePatterns, toolName) {
    if (!ignorePatterns || ignorePatterns.length === 0) {
        return true;
    }
    return ignorePatterns.every((pattern) => !patternToRegex(pattern).test(toolName));
}
function substituteEnvVars(value, env) {
    return value.replace(/\$\{([^}]+)\}/g, (_match, name) => env[name] ?? '');
}
function resolveServerCommandLine(server) {
    if (server.command) {
        return [server.command, ...server.args].join(' ');
    }
    return server.url;
}
function createClient() {
    return new Client({
        name: 'personal-agent',
        version: '1.0.0',
    }, {
        capabilities: {},
    });
}
function withTimeout(promise, timeoutMs, label) {
    if (timeoutMs <= 0) {
        return promise;
    }
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        void promise
            .then((value) => {
            clearTimeout(timeout);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}
async function openMcpClient(server, options) {
    const stderrChunks = [];
    if (server.transport === 'stdio') {
        if (!server.command) {
            throw new Error(`MCP server ${server.name} is missing a command`);
        }
        const transport = new StdioClientTransport({
            command: server.command,
            args: server.args,
            cwd: server.cwd ? normalizeConfigPath(server.cwd, dirname(options.configPath)) : options.cwd,
            env: mergeStringEnv(options.env, server.env),
            stderr: 'pipe',
        });
        transport.stderr?.on('data', (chunk) => {
            stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
        });
        const client = createClient();
        await withTimeout(client.connect(transport), options.timeoutMs, `Connecting to ${server.name}`);
        return {
            client,
            transportName: 'stdio',
            stderr: () => stderrChunks.join('').trim(),
            close: async () => {
                await client.close();
            },
        };
    }
    if (!server.url) {
        throw new Error(`MCP server ${server.name} is missing a remote URL`);
    }
    const mergedEnv = mergeStringEnv(options.env, server.env);
    const resolvedHeaders = Object.fromEntries(Object.entries(server.headers ?? {}).map(([key, value]) => [key, substituteEnvVars(value, mergedEnv)]));
    const callbackPort = await resolveCallbackPort(getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders), server.callbackPort);
    const serverUrlHash = getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders);
    const connection = await withTimeout(openRemoteMcpClient({
        serverName: server.name,
        serverUrl: server.url,
        callbackHost: server.callbackHost ?? 'localhost',
        callbackPort,
        callbackPath: server.callbackPath ?? '/oauth/callback',
        transportStrategy: server.transportStrategy ?? 'http-first',
        headers: resolvedHeaders,
        authorizeResource: server.authorizeResource,
        staticClientMetadata: server.oauthClientMetadata,
        staticClientInfo: server.oauthClientInfo,
        authTimeoutMs: server.authTimeoutMs ?? options.timeoutMs,
        serverUrlHash,
        log: options.log,
    }), options.timeoutMs, `Connecting to ${server.name}`);
    return {
        client: connection.client,
        transportName: connection.transportName,
        stderr: () => '',
        close: connection.close,
    };
}
function findServer(config, serverName) {
    const server = config.servers.find((candidate) => candidate.name === serverName);
    if (!server) {
        throw new Error(`MCP server not found: ${serverName}`);
    }
    return server;
}
function formatMcpOperationError(error, server) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Incompatible auth server: does not support dynamic client registration' && server?.transport === 'remote') {
        if (server.url === 'https://mcp.slack.com/mcp') {
            return `${message}. Slack MCP requires a fixed OAuth client. Add oauth.clientId to the slack entry in mcp_servers.json and use callback http://${server.callbackHost ?? 'localhost'}:${server.callbackPort ?? 3118}${server.callbackPath ?? '/callback'}.`;
        }
        return `${message}. Add oauth.clientId for the ${server.name} remote MCP server in mcp_servers.json.`;
    }
    return message;
}
export async function inspectMcpServer(serverName, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const env = options.env ?? process.env;
    const config = readMcpConfig({ cwd, configPath: options.configPath, env });
    const server = findServer(config, serverName);
    const stderrLogs = [];
    try {
        const connection = await openMcpClient(server, {
            configPath: config.path,
            cwd,
            env,
            timeoutMs,
            log: (message) => {
                stderrLogs.push(message);
                options.log?.(message);
            },
        });
        try {
            const toolsResult = await withTimeout(connection.client.listTools(), timeoutMs, `Listing tools for ${server.name}`);
            const tools = toolsResult.tools
                .filter((tool) => includeTool(server.ignoreTools, tool.name))
                .map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
            const commandLine = resolveServerCommandLine(server);
            const transport = server.transport === 'remote' ? connection.transportName : 'stdio';
            const info = {
                server: server.name,
                transport,
                commandLine,
                toolCount: tools.length,
                tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
                rawOutput: formatMcpServerOutput({
                    server: server.name,
                    transport,
                    commandLine,
                    tools,
                    withDescriptions: options.withDescriptions,
                }),
            };
            const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();
            return {
                stdout: info.rawOutput,
                stderr,
                exitCode: 0,
                data: info,
            };
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        return {
            stdout: '',
            stderr: stderrLogs.join('\n'),
            exitCode: 1,
            error: formatMcpOperationError(error, server),
        };
    }
}
export async function inspectMcpTool(serverName, toolName, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const env = options.env ?? process.env;
    const config = readMcpConfig({ cwd, configPath: options.configPath, env });
    const server = findServer(config, serverName);
    const stderrLogs = [];
    try {
        const connection = await openMcpClient(server, {
            configPath: config.path,
            cwd,
            env,
            timeoutMs,
            log: (message) => {
                stderrLogs.push(message);
                options.log?.(message);
            },
        });
        try {
            const toolsResult = await withTimeout(connection.client.listTools(), timeoutMs, `Listing tools for ${server.name}`);
            const tool = toolsResult.tools.find((candidate) => candidate.name === toolName && includeTool(server.ignoreTools, candidate.name));
            if (!tool) {
                throw new Error(`Tool not found: ${serverName}/${toolName}`);
            }
            const schema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
            const info = {
                server: serverName,
                tool: toolName,
                description: tool.description,
                schema,
                rawOutput: formatMcpToolOutput({
                    server: serverName,
                    tool: toolName,
                    description: tool.description,
                    schema,
                }),
            };
            const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();
            return {
                stdout: info.rawOutput,
                stderr,
                exitCode: 0,
                data: info,
            };
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        return {
            stdout: '',
            stderr: stderrLogs.join('\n'),
            exitCode: 1,
            error: formatMcpOperationError(error, server),
        };
    }
}
async function callMcpToolWithServerConfig(server, toolName, input, options) {
    const stderrLogs = [];
    try {
        const connection = await openMcpClient(server, {
            configPath: options.configPath,
            cwd: options.cwd,
            env: options.env,
            timeoutMs: options.timeoutMs,
            log: (message) => {
                stderrLogs.push(message);
                options.log?.(message);
            },
        });
        try {
            const result = await withTimeout(connection.client.callTool({
                name: toolName,
                arguments: isRecord(input) ? input : {},
            }), options.timeoutMs, `Calling ${server.name}/${toolName}`);
            const rawOutput = `${JSON.stringify(result, null, 2)}\n`;
            const stderr = [connection.stderr(), ...stderrLogs].filter(Boolean).join('\n').trim();
            return {
                stdout: rawOutput,
                stderr,
                exitCode: 0,
                data: {
                    parsed: result,
                    rawOutput,
                },
            };
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        return {
            stdout: '',
            stderr: stderrLogs.join('\n'),
            exitCode: 1,
            error: formatMcpOperationError(error, server),
        };
    }
}
/**
 * Open a persistent MCP client connection to a server config directly.
 * The caller owns the lifecycle — call close() when done.
 */
export async function connectMcpServerDirect(server, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const connection = await openMcpClient(server, { configPath: cwd, cwd, env, timeoutMs, log: options.log });
    return {
        callTool: async (toolName, input, callTimeoutMs) => {
            const t = callTimeoutMs ?? 30_000;
            return withTimeout(connection.client.callTool({ name: toolName, arguments: isRecord(input) ? input : {} }), t, `Calling ${server.name}/${toolName}`);
        },
        close: connection.close,
    };
}
export async function callMcpToolDirect(server, toolName, input, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const timeoutMs = options.timeoutMs ?? 30_000;
    return callMcpToolWithServerConfig(server, toolName, input, { cwd, configPath: cwd, env, timeoutMs, log: options.log });
}
export async function callMcpTool(serverName, toolName, input, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const timeoutMs = options.timeoutMs ?? 30_000;
    const env = options.env ?? process.env;
    const config = readMcpConfig({ cwd, configPath: options.configPath, env });
    const server = findServer(config, serverName);
    return callMcpToolWithServerConfig(server, toolName, input, {
        cwd,
        configPath: config.path,
        env,
        timeoutMs,
        log: options.log,
    });
}
export async function listMcpCatalog(options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const config = readMcpConfig({ cwd, configPath: options.configPath, env });
    const probe = options.probe ?? false;
    const servers = [];
    for (const server of config.servers) {
        if (!probe) {
            servers.push({ name: server.name });
            continue;
        }
        const inspected = await inspectMcpServer(server.name, options);
        servers.push(inspected.data
            ? { name: server.name, info: inspected.data }
            : { name: server.name, error: (inspected.error ?? inspected.stderr) || 'Unknown MCP error' });
    }
    return { config, probed: probe, servers };
}
export async function grepMcpTools(pattern, options = {}) {
    const regex = patternToRegex(pattern);
    const catalog = await listMcpCatalog({
        ...options,
        probe: true,
    });
    const matches = [];
    const errors = [];
    for (const server of catalog.servers) {
        if (server.info) {
            for (const tool of server.info.tools) {
                if (regex.test(tool.name) || regex.test(`${server.name}/${tool.name}`)) {
                    matches.push({ server: server.name, tool });
                }
            }
            continue;
        }
        if (server.error) {
            errors.push({ server: server.name, error: server.error });
        }
    }
    return {
        config: catalog.config,
        matches,
        errors,
    };
}
export async function authenticateMcpServer(serverName, options = {}) {
    return inspectMcpServer(serverName, {
        ...options,
        withDescriptions: false,
    });
}
/**
 * Trigger OAuth auth for a server config directly (no config-file lookup).
 * Connects to the server which initiates the browser OAuth flow if not already authenticated.
 */
export async function authenticateMcpServerDirect(server, options = {}) {
    const cwd = process.cwd();
    const env = options.env ?? process.env;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const stderrLogs = [];
    try {
        const connection = await openMcpClient(server, {
            configPath: cwd,
            cwd,
            env,
            timeoutMs,
            log: (message) => {
                stderrLogs.push(message);
                options.log?.(message);
            },
        });
        try {
            const toolsResult = await withTimeout(connection.client.listTools(), timeoutMs, `Listing tools for ${server.name}`);
            const tools = toolsResult.tools.map((tool) => ({ name: tool.name, description: tool.description }));
            const info = {
                server: server.name,
                transport: connection.transportName,
                toolCount: tools.length,
                tools,
                rawOutput: '',
            };
            return { stdout: '', stderr: '', exitCode: 0, data: info };
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        return {
            stdout: '',
            stderr: stderrLogs.join('\n'),
            exitCode: 1,
            error: formatMcpOperationError(error, server),
        };
    }
}
export async function clearMcpServerAuth(serverName, options = {}) {
    const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
    const env = options.env ?? process.env;
    const config = readMcpConfig({ cwd, configPath: options.configPath, env });
    const server = findServer(config, serverName);
    if (server.transport !== 'remote' || !server.url) {
        throw new Error(`MCP server ${server.name} does not use remote OAuth auth state`);
    }
    const resolvedHeaders = Object.fromEntries(Object.entries(server.headers ?? {}).map(([key, value]) => [key, substituteEnvVars(value, env)]));
    const serverUrlHash = getMcpServerUrlHash(server.url, server.authorizeResource, resolvedHeaders);
    await Promise.all([
        deleteConfigFile(serverUrlHash, 'tokens.json'),
        deleteConfigFile(serverUrlHash, 'client_info.json'),
        deleteConfigFile(serverUrlHash, 'code_verifier.txt'),
        deleteConfigFile(serverUrlHash, 'discovery.json'),
    ]);
}
/**
 * Check whether tokens exist on disk for the given server config.
 * Does not make any network calls.
 */
export function hasStoredMcpServerTokens(server) {
    if (server.transport !== 'remote' || !server.url)
        return false;
    const hash = getMcpServerUrlHash(server.url, server.authorizeResource, {});
    // Mirror getPersonalAgentMcpBaseDir / getMcpAuthConfigDir from mcp-auth-storage.ts
    const baseDir = process.env.PERSONAL_AGENT_MCP_AUTH_DIR?.trim()
        ? join(process.env.PERSONAL_AGENT_MCP_AUTH_DIR.trim(), 'v1')
        : join(homedir(), '.local', 'state', 'personal-agent', 'auth', 'mcp', 'v1');
    return existsSync(join(baseDir, `${hash}_tokens.json`));
}
/**
 * Clear stored OAuth tokens for a server config directly (no config-file lookup).
 */
export async function clearMcpServerAuthDirect(server) {
    if (server.transport !== 'remote' || !server.url) {
        throw new Error(`MCP server ${server.name} does not use remote OAuth auth state`);
    }
    const serverUrlHash = getMcpServerUrlHash(server.url, server.authorizeResource, {});
    await Promise.all([
        deleteConfigFile(serverUrlHash, 'tokens.json'),
        deleteConfigFile(serverUrlHash, 'client_info.json'),
        deleteConfigFile(serverUrlHash, 'code_verifier.txt'),
        deleteConfigFile(serverUrlHash, 'discovery.json'),
    ]);
}
