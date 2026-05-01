import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, net } from 'electron';
import { getPiAgentRuntimeDir } from '@personal-agent/core';

interface AuthFileShape {
  ['openai-codex']?: {
    access?: string;
    accountId?: string;
  };
}

export interface DesktopTranscribeFileInput {
  dataBase64: string;
  mimeType?: string;
  fileName?: string;
  language?: string;
  model?: string;
}

export interface DesktopTranscriptionResult {
  text: string;
  provider: 'openai-codex-realtime';
  model?: string;
  language?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64(input: string): Buffer {
  const normalized = input.trim();
  if (!normalized) {
    throw new Error('dataBase64 is required for transcription.');
  }
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('dataBase64 must contain valid base64 data.');
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    throw new Error('dataBase64 must decode to non-empty data.');
  }
  return decoded;
}

function sanitizeMultipartHeaderValue(value: string): string {
  return value.replace(/["\r\n\0]/g, '');
}

async function readOpenAICodexAuth(): Promise<{ token: string; accountId?: string }> {
  const authFile = join(getPiAgentRuntimeDir(), 'auth.json');
  const parsed = JSON.parse(await readFile(authFile, 'utf8')) as AuthFileShape;
  const token = parsed['openai-codex']?.access;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('OpenAI Codex transcription requires configured openai-codex auth.');
  }
  const accountId = parsed['openai-codex']?.accountId;
  return {
    token: token.trim(),
    ...(typeof accountId === 'string' && accountId.trim() ? { accountId: accountId.trim() } : {}),
  };
}

function buildMultipartBody(input: DesktopTranscribeFileInput): { body: Buffer; contentType: string } {
  const boundary = `----pa-codex-transcribe-${randomUUID()}`;
  const mimeType = sanitizeMultipartHeaderValue(input.mimeType?.trim() || 'application/octet-stream') || 'application/octet-stream';
  const fileName = sanitizeMultipartHeaderValue(input.fileName?.trim() || 'dictation.webm') || 'dictation.webm';
  const file = decodeBase64(input.dataBase64);
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
    Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`),
    file,
    Buffer.from('\r\n'),
  ];

  if (input.language?.trim()) {
    parts.push(
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="language"\r\n\r\n'),
      Buffer.from(input.language.trim()),
      Buffer.from('\r\n'),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function extractTranscriptText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTranscriptText).filter(Boolean).join(' ');
  }

  if (!isRecord(value)) {
    return '';
  }

  for (const key of ['text', 'transcript', 'transcription']) {
    const candidate = extractTranscriptText(value[key]);
    if (candidate.trim()) {
      return candidate;
    }
  }

  for (const key of ['segments', 'items', 'results']) {
    const candidate = extractTranscriptText(value[key]);
    if (candidate.trim()) {
      return candidate;
    }
  }

  return '';
}

function isCloudflareChallenge(response: Response, text: string): boolean {
  return response.status === 403 && (
    response.headers.get('cf-mitigated') === 'challenge'
    || text.includes('Just a moment')
    || text.includes('cf-browser-verification')
  );
}

async function parseCodexTranscribeResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    const challengeHint = isCloudflareChallenge(response, text) ? ' Cloudflare challenge.' : '';
    throw new Error(`Codex transcription failed: ${response.status}${challengeHint}${text ? ` ${text.slice(0, 240)}` : ''}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Codex transcription returned non-JSON response.');
  }

  const transcript = extractTranscriptText(parsed).trim();
  if (!transcript) {
    throw new Error('Codex transcription returned an empty transcript. Try speaking longer or check microphone input.');
  }
  return transcript;
}

async function loadHiddenChatGptWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:personal-agent-chatgpt-transcription',
    },
  });

  await window.loadURL('https://chatgpt.com/');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return window;
}

async function transcribeWithCodexBrowser(input: DesktopTranscribeFileInput, auth: { token: string; accountId?: string }): Promise<string> {
  const window = await loadHiddenChatGptWindow();
  try {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const input = ${JSON.stringify(input)};
      const token = ${JSON.stringify(auth.token)};
      const accountId = ${JSON.stringify(auth.accountId ?? '')};
      const binary = atob(String(input.dataBase64 || '').trim());
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const form = new FormData();
      form.append('file', new Blob([bytes], { type: input.mimeType || 'application/octet-stream' }), input.fileName || 'dictation.webm');
      if (input.language && String(input.language).trim()) {
        form.append('language', String(input.language).trim());
      }

      const headers = { Authorization: 'Bearer ' + token, originator: 'codex_cli_rs' };
      if (accountId) {
        headers['chatgpt-account-id'] = accountId;
      }

      const response = await fetch('/backend-api/transcribe', {
        method: 'POST',
        headers,
        body: form,
        credentials: 'include',
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        cfMitigated: response.headers.get('cf-mitigated'),
        text: await response.text(),
      };
    })()`, true) as { ok: boolean; status: number; statusText?: string; cfMitigated?: string | null; text: string };

    if (!result.ok) {
      const challengeHint = result.status === 403 && result.cfMitigated === 'challenge' ? ' Cloudflare challenge.' : '';
      throw new Error(`Codex transcription failed: ${result.status}${challengeHint}${result.text ? ` ${result.text.slice(0, 240)}` : ''}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text) as unknown;
    } catch {
      throw new Error('Codex transcription returned non-JSON response.');
    }

    const transcript = extractTranscriptText(parsed).trim();
    if (!transcript) {
      throw new Error('Codex transcription returned an empty transcript. Try speaking longer or check microphone input.');
    }
    return transcript;
  } finally {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
}

export async function transcribeWithCodexDesktopNet(input: DesktopTranscribeFileInput): Promise<DesktopTranscriptionResult> {
  const auth = await readOpenAICodexAuth();
  const { body, contentType } = buildMultipartBody(input);
  const response = await net.fetch('https://chatgpt.com/backend-api/transcribe', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      originator: 'codex_cli_rs',
      ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {}),
      'Content-Type': contentType,
    },
    body: body as unknown as RequestInit['body'],
  });

  let transcript: string;
  try {
    transcript = await parseCodexTranscribeResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Cloudflare challenge')) {
      throw error;
    }
    transcript = await transcribeWithCodexBrowser(input, auth);
  }

  return {
    text: transcript,
    provider: 'openai-codex-realtime',
    model: input.model?.trim() || 'gpt-4o-mini-transcribe',
    ...(input.language?.trim() ? { language: input.language.trim() } : {}),
  };
}

export const testExports = {
  buildMultipartBody,
  extractTranscriptText,
};
