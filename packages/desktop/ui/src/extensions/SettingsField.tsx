import { type ReactNode } from 'react';

import type { UnifiedSettingsEntry } from '../shared/types';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';

interface SettingsFieldProps {
  entry: UnifiedSettingsEntry;
  value: unknown;
  description?: string;
  onChange: (key: string, value: unknown) => void;
}

export function SettingsField({ entry, value, onChange }: SettingsFieldProps) {
  const currentValue = value ?? entry.default;
  const label = entry.key.split('.').pop() ?? entry.key;

  const handleChange = (newValue: unknown) => {
    onChange(entry.key, newValue);
  };

  return (
    <div className="space-y-2 py-3 first:pt-0">
      <label className="block text-[13px] font-medium text-primary">
        {label}
        {entry.description ? <span className="ml-2 font-normal text-[12px] text-secondary">{entry.description}</span> : null}
      </label>

      {renderControl(entry, currentValue, handleChange)}
    </div>
  );
}

function renderControl(entry: UnifiedSettingsEntry, currentValue: unknown, onChange: (value: unknown) => void): ReactNode {
  switch (entry.type) {
    case 'boolean':
      return (
        <label className="inline-flex items-center gap-3 text-[14px] text-primary">
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none"
          />
          <span>Enabled</span>
        </label>
      );

    case 'select':
      return (
        <select value={String(currentValue)} onChange={(e) => onChange(e.target.value)} className={INPUT_CLASS}>
          {(entry.enum ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'number':
      return (
        <input
          type="number"
          value={currentValue as number}
          placeholder={entry.placeholder}
          onChange={(e) => onChange(Number(e.target.value))}
          className={INPUT_CLASS}
        />
      );

    default:
      return (
        <input
          type="text"
          value={String(currentValue)}
          placeholder={entry.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} font-mono text-[13px]`}
          autoComplete="off"
          spellCheck={false}
        />
      );
  }
}
