import { useState, useEffect, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
};

/**
 * Number input that keeps a local string draft so the field can be empty
 * mid-edit without snapping back to the underlying numeric value
 * (e.g. delete "5" should leave the field empty, not show "0").
 */
export function NumberInput({ value, onChange, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string>(formatValue(value));

  useEffect(() => {
    if (Number(draft) !== value) {
      setDraft(formatValue(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next === '' || next === '-' || next === '.' || next === '-.') return;
        const n = Number(next);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={(e) => {
        // Leave the field empty if the user cleared it. Only restore the
        // displayed value when the draft is non-empty but unparseable.
        if (draft !== '' && !Number.isFinite(Number(draft))) {
          setDraft(formatValue(value));
        }
        onBlur?.(e);
      }}
    />
  );
}

function formatValue(v: number): string {
  return Number.isFinite(v) ? String(v) : '';
}
