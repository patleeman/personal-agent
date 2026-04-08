import { describe, expect, it } from 'vitest';
import { resolveSpaIndexRelativePath } from './spaIndex.js';

describe('resolveSpaIndexRelativePath', () => {
  it('routes companion app requests to the companion html entry', () => {
    expect(resolveSpaIndexRelativePath('/app')).toBe('app/index.html');
    expect(resolveSpaIndexRelativePath('/app/')).toBe('app/index.html');
    expect(resolveSpaIndexRelativePath('/app/conversations/123')).toBe('app/index.html');
  });

  it('keeps desktop routes on the main html entry', () => {
    expect(resolveSpaIndexRelativePath('/')).toBe('index.html');
    expect(resolveSpaIndexRelativePath('/conversations/123')).toBe('index.html');
    expect(resolveSpaIndexRelativePath('/conversations/new')).toBe('index.html');
  });
});
