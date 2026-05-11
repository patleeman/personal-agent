import { describe, expect, it } from 'vitest';

import { prepareTransferableResultBody, prepareTransferableUint8Array } from './worker-transfer.js';

describe('worker transfer helpers', () => {
  it('transfers full Uint8Array buffers without copying', () => {
    const body = new Uint8Array([1, 2, 3]);

    const prepared = prepareTransferableUint8Array(body);

    expect(prepared.value).toBe(body);
    expect(prepared.transferList).toEqual([body.buffer]);
  });

  it('copies sliced Uint8Array views before transferring', () => {
    const source = new Uint8Array([0, 1, 2, 3]);
    const body = source.subarray(1, 3);

    const prepared = prepareTransferableUint8Array(body);

    expect(prepared.value).not.toBe(body);
    expect(Array.from(prepared.value)).toEqual([1, 2]);
    expect(prepared.value.byteOffset).toBe(0);
    expect(prepared.value.byteLength).toBe(prepared.value.buffer.byteLength);
    expect(prepared.transferList).toEqual([prepared.value.buffer]);
  });

  it('prepares local API response bodies for zero-copy worker replies', () => {
    const body = new Uint8Array([4, 5, 6]);
    const result = { statusCode: 200, headers: {}, body };

    const prepared = prepareTransferableResultBody(result);

    expect(prepared.result).toBe(result);
    expect(prepared.transferList).toEqual([body.buffer]);
  });
});
