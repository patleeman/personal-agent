// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitKBEvent, onKBEvent } from './knowledgeEvents';

// ── knowledgeEvents — event bus for knowledge base sync ──────────────────

describe('knowledgeEvents', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits and receives a file-renamed event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:file-renamed', handler);
    emitKBEvent('kb:file-renamed', { oldId: 'a.md', newId: 'b.md' });
    expect(handler).toHaveBeenCalledWith({ oldId: 'a.md', newId: 'b.md' });
    cleanup();
  });

  it('emits and receives a file-created event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:file-created', handler);
    emitKBEvent('kb:file-created', { id: 'new.md' });
    expect(handler).toHaveBeenCalledWith({ id: 'new.md' });
    cleanup();
  });

  it('emits and receives a file-deleted event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:file-deleted', handler);
    emitKBEvent('kb:file-deleted', { id: 'gone.md' });
    expect(handler).toHaveBeenCalledWith({ id: 'gone.md' });
    cleanup();
  });

  it('emits entries-changed event without detail', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:entries-changed', handler);
    emitKBEvent('kb:entries-changed');
    expect(handler).toHaveBeenCalled();
    cleanup();
  });

  it('emits content-saved event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:content-saved', handler);
    emitKBEvent('kb:content-saved');
    expect(handler).toHaveBeenCalled();
    cleanup();
  });

  it('emits close-active-file event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:close-active-file', handler);
    emitKBEvent('kb:close-active-file');
    expect(handler).toHaveBeenCalled();
    cleanup();
  });

  it('emits file-changed-externally event with path', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:file-changed-externally', handler);
    emitKBEvent('kb:file-changed-externally', { path: '/tmp/file.md' });
    expect(handler).toHaveBeenCalledWith({ path: '/tmp/file.md' });
    cleanup();
  });

  it('emits reopen-closed-file event', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:reopen-closed-file', handler);
    emitKBEvent('kb:reopen-closed-file');
    expect(handler).toHaveBeenCalled();
    cleanup();
  });

  it('cleanup removes the event listener', () => {
    const handler = vi.fn();
    const cleanup = onKBEvent('kb:entries-changed', handler);
    cleanup();
    emitKBEvent('kb:entries-changed');
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call handler for unsubscribed event types', () => {
    const handler = vi.fn();
    onKBEvent('kb:file-created', handler);
    emitKBEvent('kb:file-renamed', { oldId: 'a', newId: 'b' });
    expect(handler).not.toHaveBeenCalled();
  });
});
