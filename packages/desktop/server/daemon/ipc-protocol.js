function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function hasId(value) {
    return typeof value.id === 'string' && value.id.length > 0;
}
function readRequiredString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value.trim();
}
function readOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
function readOptionalBoolean(value, label) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean`);
    }
    return value;
}
function readBackgroundRunAgent(value) {
    if (value === undefined) {
        return undefined;
    }
    if (!isRecord(value)) {
        throw new Error('runs.startBackground agent must be an object when provided');
    }
    const prompt = readRequiredString(value.prompt, 'runs.startBackground agent.prompt');
    const profile = readOptionalString(value.profile);
    const model = readOptionalString(value.model);
    const noSession = readOptionalBoolean(value.noSession, 'runs.startBackground agent.noSession');
    return {
        prompt,
        ...(profile ? { profile } : {}),
        ...(model ? { model } : {}),
        ...(noSession !== undefined ? { noSession } : {}),
    };
}
function readBackgroundRunInput(value) {
    if (!isRecord(value)) {
        throw new Error('runs.startBackground input must be an object');
    }
    const rawArgv = value.argv;
    if (rawArgv !== undefined && !Array.isArray(rawArgv)) {
        throw new Error('runs.startBackground argv must be an array when provided');
    }
    const manifestMetadata = value.manifestMetadata;
    if (manifestMetadata !== undefined && !isRecord(manifestMetadata)) {
        throw new Error('runs.startBackground manifestMetadata must be an object when provided');
    }
    const callbackConversation = value.callbackConversation;
    if (callbackConversation !== undefined && !isRecord(callbackConversation)) {
        throw new Error('runs.startBackground callbackConversation must be an object when provided');
    }
    const checkpointPayload = value.checkpointPayload;
    if (checkpointPayload !== undefined && !isRecord(checkpointPayload)) {
        throw new Error('runs.startBackground checkpointPayload must be an object when provided');
    }
    const argv = Array.isArray(rawArgv)
        ? rawArgv.map((entry, index) => readRequiredString(entry, `runs.startBackground argv[${index}]`))
        : undefined;
    const shellCommand = readOptionalString(value.shellCommand);
    const agent = readBackgroundRunAgent(value.agent);
    return {
        taskSlug: readRequiredString(value.taskSlug, 'runs.startBackground taskSlug'),
        cwd: readRequiredString(value.cwd, 'runs.startBackground cwd'),
        ...(argv ? { argv } : {}),
        ...(shellCommand ? { shellCommand } : {}),
        ...(agent ? { agent } : {}),
        ...(isRecord(value.source)
            ? {
                source: {
                    type: readRequiredString(value.source.type, 'runs.startBackground source.type'),
                    ...(readOptionalString(value.source.id) ? { id: readOptionalString(value.source.id) } : {}),
                    ...(readOptionalString(value.source.filePath) ? { filePath: readOptionalString(value.source.filePath) } : {}),
                },
            }
            : {}),
        ...(callbackConversation
            ? {
                callbackConversation: {
                    conversationId: readRequiredString(callbackConversation.conversationId, 'runs.startBackground callbackConversation.conversationId'),
                    sessionFile: readRequiredString(callbackConversation.sessionFile, 'runs.startBackground callbackConversation.sessionFile'),
                    profile: readRequiredString(callbackConversation.profile, 'runs.startBackground callbackConversation.profile'),
                    ...(readOptionalString(callbackConversation.repoRoot) ? { repoRoot: readOptionalString(callbackConversation.repoRoot) } : {}),
                },
            }
            : {}),
        ...(manifestMetadata ? { manifestMetadata } : {}),
        ...(checkpointPayload ? { checkpointPayload } : {}),
    };
}
function readConversationRunState(value) {
    if (value === 'waiting' || value === 'running' || value === 'interrupted' || value === 'failed') {
        return value;
    }
    throw new Error('conversations.sync state must be waiting, running, interrupted, or failed');
}
function readConversationRunInput(value) {
    if (!isRecord(value)) {
        throw new Error('conversations.sync input must be an object');
    }
    const pendingOperation = value.pendingOperation;
    if (pendingOperation !== undefined && pendingOperation !== null && !isRecord(pendingOperation)) {
        throw new Error('conversations.sync pendingOperation must be an object when provided');
    }
    return {
        conversationId: readRequiredString(value.conversationId, 'conversations.sync conversationId'),
        sessionFile: readRequiredString(value.sessionFile, 'conversations.sync sessionFile'),
        cwd: readRequiredString(value.cwd, 'conversations.sync cwd'),
        state: readConversationRunState(value.state),
        title: readOptionalString(value.title),
        profile: readOptionalString(value.profile),
        updatedAt: readOptionalString(value.updatedAt),
        lastError: readOptionalString(value.lastError),
        ...(pendingOperation !== undefined
            ? { pendingOperation: pendingOperation }
            : {}),
    };
}
export function parseRequest(raw) {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || !hasId(parsed)) {
        throw new Error('Invalid request envelope');
    }
    if (parsed.type === 'emit') {
        if (!('event' in parsed)) {
            throw new Error('emit request must include event');
        }
        return {
            id: parsed.id,
            type: 'emit',
            event: parsed.event,
        };
    }
    if (parsed.type === 'runs.list') {
        return {
            id: parsed.id,
            type: 'runs.list',
        };
    }
    if (parsed.type === 'runs.get') {
        return {
            id: parsed.id,
            type: 'runs.get',
            runId: readRequiredString(parsed.runId, 'runs.get runId'),
        };
    }
    if (parsed.type === 'runs.startTask') {
        return {
            id: parsed.id,
            type: 'runs.startTask',
            taskId: readRequiredString(parsed.taskId, 'runs.startTask taskId'),
        };
    }
    if (parsed.type === 'runs.startBackground') {
        return {
            id: parsed.id,
            type: 'runs.startBackground',
            input: readBackgroundRunInput(parsed.input),
        };
    }
    if (parsed.type === 'runs.cancel') {
        return {
            id: parsed.id,
            type: 'runs.cancel',
            runId: readRequiredString(parsed.runId, 'runs.cancel runId'),
        };
    }
    if (parsed.type === 'runs.rerun') {
        return {
            id: parsed.id,
            type: 'runs.rerun',
            runId: readRequiredString(parsed.runId, 'runs.rerun runId'),
        };
    }
    if (parsed.type === 'runs.followUp') {
        return {
            id: parsed.id,
            type: 'runs.followUp',
            runId: readRequiredString(parsed.runId, 'runs.followUp runId'),
            ...(readOptionalString(parsed.prompt) ? { prompt: readOptionalString(parsed.prompt) } : {}),
        };
    }
    if (parsed.type === 'conversations.sync') {
        return {
            id: parsed.id,
            type: 'conversations.sync',
            input: readConversationRunInput(parsed.input),
        };
    }
    if (parsed.type === 'conversations.recoverable') {
        return {
            id: parsed.id,
            type: 'conversations.recoverable',
        };
    }
    if (parsed.type === 'status' || parsed.type === 'stop' || parsed.type === 'ping') {
        return {
            id: parsed.id,
            type: parsed.type,
        };
    }
    throw new Error(`Unknown request type: ${String(parsed.type)}`);
}
export function serializeResponse(response) {
    return `${JSON.stringify(response)}\n`;
}
