export function prepareTransferableUint8Array(value: Uint8Array): { value: Uint8Array; transferList: ArrayBuffer[] } {
  if (value.byteLength === 0) {
    return { value, transferList: [] };
  }

  if (!(value.buffer instanceof ArrayBuffer)) {
    return { value, transferList: [] };
  }

  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return { value, transferList: [value.buffer] };
  }

  const copied = Uint8Array.from(value);
  return { value: copied, transferList: [copied.buffer] };
}

export function prepareTransferableResultBody<T>(result: T): { result: T; transferList: ArrayBuffer[] } {
  if (!result || typeof result !== 'object' || !('body' in result)) {
    return { result, transferList: [] };
  }

  const body = (result as { body?: unknown }).body;
  if (!(body instanceof Uint8Array)) {
    return { result, transferList: [] };
  }

  const prepared = prepareTransferableUint8Array(body);
  if (prepared.value === body) {
    return { result, transferList: prepared.transferList };
  }

  return {
    result: {
      ...result,
      body: prepared.value,
    },
    transferList: prepared.transferList,
  };
}
