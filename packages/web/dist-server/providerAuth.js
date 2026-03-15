import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
const OAUTH_LOGIN_RETENTION_MS = 30 * 60_000;
const oauthLoginRuns = new Map();
function nowIso() {
    return new Date().toISOString();
}
function createLoginId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function normalizeProvider(provider) {
    return provider.trim();
}
function readModelCounts(authStorage) {
    const registry = new ModelRegistry(authStorage);
    const counts = new Map();
    for (const model of registry.getAvailable()) {
        const provider = typeof model.provider === 'string' ? model.provider.trim() : '';
        if (!provider) {
            continue;
        }
        counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return counts;
}
function deriveAuthType(authStorage, provider) {
    const credential = authStorage.get(provider);
    const hasStoredCredential = credential !== undefined;
    if (credential?.type === 'oauth') {
        return { authType: 'oauth', hasStoredCredential };
    }
    if (credential?.type === 'api_key') {
        return { authType: 'api_key', hasStoredCredential };
    }
    if (authStorage.hasAuth(provider)) {
        return { authType: 'environment', hasStoredCredential };
    }
    return { authType: 'none', hasStoredCredential };
}
function makeAuthStorage(authFile) {
    return AuthStorage.create(authFile);
}
export function readProviderAuthState(authFile) {
    const authStorage = makeAuthStorage(authFile);
    const modelCounts = readModelCounts(authStorage);
    const oauthProvidersById = new Map(authStorage.getOAuthProviders().map((provider) => [provider.id, provider]));
    const providers = new Set([
        ...modelCounts.keys(),
        ...authStorage.list(),
        ...oauthProvidersById.keys(),
    ]);
    const summaries = [...providers]
        .sort((left, right) => left.localeCompare(right))
        .map((provider) => {
        const oauthProvider = oauthProvidersById.get(provider);
        const { authType, hasStoredCredential } = deriveAuthType(authStorage, provider);
        return {
            id: provider,
            modelCount: modelCounts.get(provider) ?? 0,
            authType,
            hasStoredCredential,
            oauthSupported: oauthProvider !== undefined,
            oauthProviderName: oauthProvider?.name ?? '',
            oauthUsesCallbackServer: Boolean(oauthProvider?.usesCallbackServer),
        };
    });
    return {
        authFile,
        providers: summaries,
    };
}
export function setProviderApiKey(authFile, providerInput, apiKeyInput) {
    const provider = normalizeProvider(providerInput);
    if (!provider) {
        throw new Error('provider is required');
    }
    const apiKey = apiKeyInput.trim();
    if (!apiKey) {
        throw new Error('apiKey is required');
    }
    const authStorage = makeAuthStorage(authFile);
    authStorage.set(provider, {
        type: 'api_key',
        key: apiKey,
    });
    return readProviderAuthState(authFile);
}
export function removeProviderCredential(authFile, providerInput) {
    const provider = normalizeProvider(providerInput);
    if (!provider) {
        throw new Error('provider is required');
    }
    const authStorage = makeAuthStorage(authFile);
    authStorage.remove(provider);
    return readProviderAuthState(authFile);
}
function toPromptState(prompt, manualCode) {
    return {
        message: prompt.message,
        placeholder: typeof prompt.placeholder === 'string' ? prompt.placeholder : '',
        allowEmpty: prompt.allowEmpty === true,
        manualCode,
    };
}
function rejectPendingInput(run, reason) {
    const pendingInput = run.pendingInput;
    run.pendingInput = null;
    if (!pendingInput) {
        return;
    }
    pendingInput.reject(new Error(reason));
}
function createPromptAwaiter(run, prompt) {
    rejectPendingInput(run, 'Login prompt superseded.');
    run.prompt = prompt;
    run.updatedAt = nowIso();
    return new Promise((resolve, reject) => {
        if (run.abortController.signal.aborted) {
            reject(new Error('Login cancelled'));
            return;
        }
        run.pendingInput = {
            allowEmpty: prompt.allowEmpty,
            resolve,
            reject,
        };
    });
}
function toPublicLoginState(run) {
    return {
        id: run.id,
        provider: run.provider,
        providerName: run.providerName,
        status: run.status,
        authUrl: run.authUrl,
        authInstructions: run.authInstructions,
        prompt: run.prompt ? { ...run.prompt } : null,
        progress: [...run.progress],
        error: run.error,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
    };
}
function pruneOAuthLoginRuns() {
    const now = Date.now();
    for (const [id, run] of oauthLoginRuns) {
        if (run.status === 'running') {
            continue;
        }
        const updatedAtMs = Date.parse(run.updatedAt);
        if (Number.isNaN(updatedAtMs)) {
            continue;
        }
        if (now - updatedAtMs > OAUTH_LOGIN_RETENTION_MS) {
            oauthLoginRuns.delete(id);
        }
    }
}
function finalizeOAuthLogin(run, status, error) {
    rejectPendingInput(run, status === 'completed' ? 'Login completed' : 'Login cancelled');
    run.prompt = null;
    run.status = status;
    run.error = error;
    run.updatedAt = nowIso();
}
function appendProgress(run, message) {
    const normalized = message.trim();
    if (!normalized) {
        return;
    }
    run.progress = [...run.progress, normalized].slice(-12);
    run.updatedAt = nowIso();
}
function isOAuthCredential(credential) {
    return credential?.type === 'oauth';
}
export function startProviderOAuthLogin(authFile, providerInput) {
    pruneOAuthLoginRuns();
    const provider = normalizeProvider(providerInput);
    if (!provider) {
        throw new Error('provider is required');
    }
    const authStorage = makeAuthStorage(authFile);
    const oauthProvider = authStorage.getOAuthProviders().find((candidate) => candidate.id === provider);
    if (!oauthProvider) {
        throw new Error(`Provider does not support OAuth login: ${provider}`);
    }
    for (const run of oauthLoginRuns.values()) {
        if (run.provider === provider && run.status === 'running') {
            run.abortController.abort();
            finalizeOAuthLogin(run, 'cancelled', '');
        }
    }
    const timestamp = nowIso();
    const run = {
        id: createLoginId(),
        provider,
        providerName: oauthProvider.name,
        status: 'running',
        authUrl: '',
        authInstructions: '',
        prompt: null,
        progress: [],
        error: '',
        createdAt: timestamp,
        updatedAt: timestamp,
        abortController: new AbortController(),
        pendingInput: null,
    };
    oauthLoginRuns.set(run.id, run);
    void authStorage.login(provider, {
        onAuth: (info) => {
            run.authUrl = info.url;
            run.authInstructions = typeof info.instructions === 'string' ? info.instructions : '';
            run.updatedAt = nowIso();
        },
        onPrompt: async (prompt) => {
            const state = toPromptState(prompt, false);
            return createPromptAwaiter(run, state);
        },
        onProgress: (message) => {
            appendProgress(run, message);
        },
        onManualCodeInput: async () => createPromptAwaiter(run, {
            message: 'Paste redirect URL below, or complete login in your browser.',
            placeholder: 'https://localhost:1455/auth/callback?code=...',
            allowEmpty: false,
            manualCode: true,
        }),
        signal: run.abortController.signal,
    }).then(() => {
        const credential = authStorage.get(provider);
        if (!isOAuthCredential(credential)) {
            finalizeOAuthLogin(run, 'failed', `OAuth login for ${provider} did not persist credentials.`);
            return;
        }
        finalizeOAuthLogin(run, 'completed', '');
    }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (run.abortController.signal.aborted || message === 'Login cancelled') {
            finalizeOAuthLogin(run, 'cancelled', '');
            return;
        }
        finalizeOAuthLogin(run, 'failed', message);
    });
    return toPublicLoginState(run);
}
export function getProviderOAuthLoginState(loginId) {
    pruneOAuthLoginRuns();
    const run = oauthLoginRuns.get(loginId);
    if (!run) {
        return null;
    }
    return toPublicLoginState(run);
}
export function submitProviderOAuthLoginInput(loginId, valueInput) {
    pruneOAuthLoginRuns();
    const run = oauthLoginRuns.get(loginId);
    if (!run) {
        throw new Error(`OAuth login not found: ${loginId}`);
    }
    if (run.status !== 'running') {
        throw new Error(`OAuth login is not running: ${loginId}`);
    }
    const pendingInput = run.pendingInput;
    if (!pendingInput) {
        throw new Error('OAuth login is not waiting for input');
    }
    const value = valueInput;
    if (!pendingInput.allowEmpty && value.trim().length === 0) {
        throw new Error('Input is required');
    }
    run.pendingInput = null;
    run.prompt = null;
    run.updatedAt = nowIso();
    pendingInput.resolve(value);
    return toPublicLoginState(run);
}
export function cancelProviderOAuthLogin(loginId) {
    pruneOAuthLoginRuns();
    const run = oauthLoginRuns.get(loginId);
    if (!run) {
        throw new Error(`OAuth login not found: ${loginId}`);
    }
    if (run.status === 'running') {
        run.abortController.abort();
        finalizeOAuthLogin(run, 'cancelled', '');
    }
    return toPublicLoginState(run);
}
