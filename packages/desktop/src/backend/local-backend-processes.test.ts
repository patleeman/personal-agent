import { describe, expect, it } from 'vitest';

import { LocalBackendProcesses } from './local-backend-processes.js';

describe('LocalBackendProcesses', () => {
  it('starts', async () => {
    const backend = new LocalBackendProcesses();
    expect(backend).toBeDefined();
  });
});
