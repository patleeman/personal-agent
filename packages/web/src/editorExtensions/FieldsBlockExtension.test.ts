import { describe, expect, it } from 'vitest';
import { parseFieldsBlockItems, serializeFieldsBlockItems } from './FieldsBlockExtension';

describe('FieldsBlockExtension helpers', () => {
  it('parses colon-delimited key value rows', () => {
    expect(parseFieldsBlockItems('summary: Durable note\nstatus: active\ntags: notes, ui')).toEqual([
      { key: 'summary', value: 'Durable note' },
      { key: 'status', value: 'active' },
      { key: 'tags', value: 'notes, ui' },
    ]);
  });

  it('drops empty rows when serializing', () => {
    expect(serializeFieldsBlockItems([
      { key: 'summary', value: 'Durable note' },
      { key: '', value: '' },
      { key: 'status', value: 'active' },
    ])).toBe('summary: Durable note\nstatus: active');
  });
});
