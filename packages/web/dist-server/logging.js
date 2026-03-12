function formatValue(value) {
    if (value === undefined) {
        return 'undefined';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function formatFields(fields) {
    if (!fields) {
        return '';
    }
    const entries = Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${formatValue(value)}`);
    return entries.length > 0 ? ` ${entries.join(' ')}` : '';
}
function emit(level, message, fields) {
    const line = `[${new Date().toISOString()}] [web] [${level}] ${message}${formatFields(fields)}`;
    if (level === 'error') {
        console.error(line);
        return;
    }
    if (level === 'warn') {
        console.warn(line);
        return;
    }
    console.log(line);
}
export function logInfo(message, fields) {
    emit('info', message, fields);
}
export function logWarn(message, fields) {
    emit('warn', message, fields);
}
export function logError(message, fields) {
    emit('error', message, fields);
}
function normalizeDurationMs(start) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    return Math.round(durationMs * 10) / 10;
}
function shouldLogRequest(req) {
    return req.path.startsWith('/api/');
}
export function webRequestLoggingMiddleware(req, res, next) {
    if (!shouldLogRequest(req)) {
        next();
        return;
    }
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        const statusCode = res.statusCode;
        const durationMs = normalizeDurationMs(startedAt);
        const fields = {
            method: req.method,
            path: req.originalUrl || req.url,
            status: statusCode,
            durationMs,
            contentLength: res.getHeader('content-length'),
        };
        if (statusCode >= 500) {
            logError('request failed', fields);
            return;
        }
        if (statusCode >= 400) {
            logWarn('request completed', fields);
            return;
        }
        logInfo('request completed', fields);
    });
    next();
}
let processLoggingInstalled = false;
export function installProcessLogging() {
    if (processLoggingInstalled) {
        return;
    }
    processLoggingInstalled = true;
    process.on('uncaughtExceptionMonitor', (error) => {
        logError('uncaught exception', {
            message: error.message,
            stack: error.stack,
        });
    });
    process.on('unhandledRejection', (reason) => {
        logError('unhandled rejection', {
            reason: reason instanceof Error
                ? {
                    message: reason.message,
                    stack: reason.stack,
                }
                : reason,
        });
    });
    process.on('SIGTERM', () => {
        logInfo('received SIGTERM');
    });
    process.on('SIGINT', () => {
        logInfo('received SIGINT');
    });
}
