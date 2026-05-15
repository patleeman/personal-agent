import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  collectAssistantErrorMessages,
  collectAssistantTexts,
  extractTextContent,
  shouldRunBackgroundAgentMain,
} from './background-agent-runner.js';

describe('background agent runner output capture', () => {
  it('extracts final assistant text from session messages when no stream deltas were captured', () => {
    expect(
      collectAssistantTexts({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'subagent works' }] },
        ],
      }),
    ).toEqual(['subagent works']);
  });

  it('extracts string and multipart text content', () => {
    expect(extractTextContent('plain text')).toBe('plain text');
    expect(extractTextContent([{ type: 'text', text: 'first' }, { type: 'image', data: 'ignored' }, 'second'])).toBe('first\nsecond');
  });

  it('captures assistant error messages for failed subagent logs and result summaries', () => {
    expect(
      collectAssistantErrorMessages({
        messages: [
          { role: 'assistant', content: [], errorMessage: '  model exploded  ' },
          { role: 'assistant', content: [{ type: 'text', text: 'ignored' }] },
        ],
      }),
    ).toEqual(['model exploded']);
  });

  it('runs from daemon-spawned Electron Node children even when argv path differs', () => {
    const moduleUrl = pathToFileURL(
      '/Applications/Personal Agent RC.app/Contents/Resources/app.asar/server/dist/background-agent-runner.js',
    ).href;

    expect(shouldRunBackgroundAgentMain(moduleUrl, '/private/var/folders/runner.js', { PERSONAL_AGENT_RUN_ID: 'run-123' })).toBe(true);
    expect(shouldRunBackgroundAgentMain(moduleUrl, fileURLToPath(moduleUrl), {})).toBe(true);
    expect(shouldRunBackgroundAgentMain(moduleUrl, '/private/var/folders/runner.js', {})).toBe(false);
  });
});
