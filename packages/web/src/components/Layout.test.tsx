import { describe, expect, it } from 'vitest';
import { resolveRouteContentBoundaryErrorMessage } from './Layout.js';

describe('resolveRouteContentBoundaryErrorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(resolveRouteContentBoundaryErrorMessage(new Error('Port 3741 on 127.0.0.1 is already in use.'))).toBe(
      'Port 3741 on 127.0.0.1 is already in use.',
    );
  });

  it('trims string errors and drops blank values', () => {
    expect(resolveRouteContentBoundaryErrorMessage('  renderer crashed  ')).toBe('renderer crashed');
    expect(resolveRouteContentBoundaryErrorMessage('   ')).toBeNull();
  });

  it('returns null for unknown values without a readable message', () => {
    expect(resolveRouteContentBoundaryErrorMessage({ message: 'hidden' })).toBeNull();
    expect(resolveRouteContentBoundaryErrorMessage(null)).toBeNull();
  });
});
