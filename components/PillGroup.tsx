"use client";

interface PillOption<T extends string> {
  value: T;
  label: string;
}

interface PillGroupProps<T extends string> {
  value: T;
  options: PillOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

export default function PillGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: PillGroupProps<T>) {
  return (
    <div className="pills" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          aria-selected={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
