import { type FormEvent, useEffect, useRef, useState } from 'react';

export interface TextPromptDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  allowEmpty?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

export function TextPromptDialog({
  title,
  label,
  initialValue = '',
  placeholder,
  confirmLabel = 'Continue',
  allowEmpty = false,
  onCancel,
  onSubmit,
}: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const canSubmit = allowEmpty || value.trim().length > 0;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(value);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4 py-8 backdrop-blur-sm" onClick={onCancel}>
      <form
        className="w-full max-w-md rounded-2xl border border-border-subtle bg-base p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="text-[16px] font-semibold text-primary">{title}</h2>
        <label className="mt-4 block text-[12px] font-medium text-secondary">
          {label}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            className="mt-2 w-full rounded-xl border border-border-subtle bg-surface/40 px-3 py-2 text-[13px] text-primary outline-none transition-colors placeholder:text-dim focus:border-accent/50"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl px-4 py-2 text-[13px] text-secondary hover:bg-surface hover:text-primary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-xl border border-accent/50 bg-accent/15 px-4 py-2 text-[13px] font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
