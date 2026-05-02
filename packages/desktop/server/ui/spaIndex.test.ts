import { describe, expect, it } from 'vitest';

import { resolveSpaIndexRelativePath } from './spaIndex.js';

describe('resolveSpaIndexRelativePath', () => {
  it('always resolves to the main html entry', () => {
    expect(resolveSpaIndexRelativePath('/')).toBe('index.html');
    expect(resolveSpaIndexRelativePath('/app')).toBe('index.html');
    expect(resolveSpaIndexRelativePath('/conversations/123')).toBe('index.html');
    expect(resolveSpaIndexRelativePath('/conversations/new')).toBe('index.html');
  });
});
