import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { estimateContextUsageSegments, readSessionContextUsageFromFile } from './sessionContextUsage.js';
const tempDirs = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function createTempSessionFile(lines) {
    const dir = mkdtempSync(join(tmpdir(), 'pa-web-session-context-'));
    tempDirs.push(dir);
    const file = join(dir, 'session.jsonl');
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    return file;
}
function sumSegments(segments) {
    return segments?.reduce((sum, segment) => sum + segment.tokens, 0) ?? 0;
}
describe('readSessionContextUsageFromFile', () => {
    it('splits effective context into scaled user, assistant, and tool segments', () => {
        const segments = estimateContextUsageSegments([
            { role: 'user', content: [{ type: 'text', text: 'review the diff' }] },
            {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: 'plan' },
                    { type: 'toolCall', id: 'tool-1', name: 'read', arguments: { path: 'README.md' } },
                    { type: 'text', text: 'I checked the file.' },
                ],
                provider: 'openai-codex',
                model: 'gpt-5.4',
                stopReason: 'stop',
                usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                timestamp: Date.parse('2026-03-10T20:00:01.000Z'),
            },
            { role: 'toolResult', toolCallId: 'tool-1', toolName: 'read', content: [{ type: 'text', text: 'some output' }], timestamp: Date.parse('2026-03-10T20:00:02.000Z') },
        ], 1_200);
        expect(sumSegments(segments)).toBe(1_200);
        expect(segments).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'user' }),
            expect.objectContaining({ key: 'assistant' }),
            expect.objectContaining({ key: 'tool' }),
        ]));
    });
    it('returns null context tokens after compaction until a post-compaction assistant responds', () => {
        const file = createTempSessionFile([
            { type: 'session', id: 'session-1', timestamp: '2026-03-10T20:00:00.000Z', cwd: '/tmp/project', version: 3 },
            { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-03-10T20:00:01.000Z', provider: 'openai-codex', modelId: 'gpt-5.4' },
            { type: 'message', id: 'u1', parentId: 'm1', timestamp: '2026-03-10T20:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.parse('2026-03-10T20:00:02.000Z') } },
            {
                type: 'message',
                id: 'a1',
                parentId: 'u1',
                timestamp: '2026-03-10T20:00:03.000Z',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'hi' }],
                    provider: 'openai-codex',
                    model: 'gpt-5.4',
                    usage: { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                    stopReason: 'stop',
                    timestamp: Date.parse('2026-03-10T20:00:03.000Z'),
                },
            },
            { type: 'compaction', id: 'c1', parentId: 'a1', timestamp: '2026-03-10T20:00:04.000Z', summary: 'Compacted.', firstKeptEntryId: 'u1', tokensBefore: 1100 },
            { type: 'message', id: 'u2', parentId: 'c1', timestamp: '2026-03-10T20:00:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'continue' }], timestamp: Date.parse('2026-03-10T20:00:05.000Z') } },
        ]);
        expect(readSessionContextUsageFromFile(file)).toEqual({ tokens: null, modelId: 'gpt-5.4' });
    });
    it('uses post-compaction assistant usage instead of pre-compaction transcript totals', () => {
        const file = createTempSessionFile([
            { type: 'session', id: 'session-1', timestamp: '2026-03-10T20:00:00.000Z', cwd: '/tmp/project', version: 3 },
            { type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-03-10T20:00:01.000Z', provider: 'openai-codex', modelId: 'gpt-5.4' },
            { type: 'message', id: 'u1', parentId: 'm1', timestamp: '2026-03-10T20:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: Date.parse('2026-03-10T20:00:02.000Z') } },
            {
                type: 'message',
                id: 'a1',
                parentId: 'u1',
                timestamp: '2026-03-10T20:00:03.000Z',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'hi' }],
                    provider: 'openai-codex',
                    model: 'gpt-5.4',
                    usage: { input: 200000, output: 15000, cacheRead: 0, cacheWrite: 0, totalTokens: 215000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                    stopReason: 'stop',
                    timestamp: Date.parse('2026-03-10T20:00:03.000Z'),
                },
            },
            { type: 'compaction', id: 'c1', parentId: 'a1', timestamp: '2026-03-10T20:00:04.000Z', summary: 'Compacted.', firstKeptEntryId: 'u1', tokensBefore: 215000 },
            { type: 'message', id: 'u2', parentId: 'c1', timestamp: '2026-03-10T20:00:05.000Z', message: { role: 'user', content: [{ type: 'text', text: 'continue' }], timestamp: Date.parse('2026-03-10T20:00:05.000Z') } },
            {
                type: 'message',
                id: 'a2',
                parentId: 'u2',
                timestamp: '2026-03-10T20:00:06.000Z',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'done' }],
                    provider: 'openai-codex',
                    model: 'gpt-5.4',
                    usage: { input: 14000, output: 800, cacheRead: 0, cacheWrite: 0, totalTokens: 14800, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
                    stopReason: 'stop',
                    timestamp: Date.parse('2026-03-10T20:00:06.000Z'),
                },
            },
        ]);
        const usage = readSessionContextUsageFromFile(file);
        expect(usage).toEqual(expect.objectContaining({
            tokens: 14800,
            modelId: 'gpt-5.4',
            segments: expect.arrayContaining([
                expect.objectContaining({ key: 'user' }),
                expect.objectContaining({ key: 'assistant' }),
                expect.objectContaining({ key: 'summary' }),
            ]),
        }));
        expect(sumSegments(usage?.segments)).toBe(14800);
    });
});
