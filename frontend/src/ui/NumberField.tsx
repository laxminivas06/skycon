import React from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  className?: string;
  disabled?: boolean;
}

export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  className = '',
  disabled = false,
}) => {
  const handleIncrement = () => {
    if (disabled) return;
    const next = Math.min(max, +(value + step).toFixed(2));
    onChange(next);
  };

  const handleDecrement = () => {
    if (disabled) return;
    const next = Math.max(min, +(value - step).toFixed(2));
    onChange(next);
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] font-semibold text-[var(--uav-muted)] select-none">
        {label}
      </label>
      <div className="relative flex items-center rounded-[8px] border border-[var(--uav-card-border)] bg-[#11161D] px-2.5 py-1.5 focus-within:border-[var(--uav-primary-blue)] transition">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) {
              onChange(Math.max(min, Math.min(max, v)));
            }
          }}
          className="w-full bg-transparent font-mono text-[13px] text-[var(--uav-text)] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="flex flex-col items-center justify-center -mr-1">
          <button
            type="button"
            onClick={handleIncrement}
            disabled={disabled || value >= max}
            tabIndex={-1}
            aria-label="Increment value"
            className="w-4 h-3 flex items-center justify-center text-[var(--uav-muted)] hover:text-white disabled:opacity-30 cursor-pointer"
          >
            <ChevronUp className="w-3 h-3 stroke-[3]" />
          </button>
          <button
            type="button"
            onClick={handleDecrement}
            disabled={disabled || value <= min}
            tabIndex={-1}
            aria-label="Decrement value"
            className="w-4 h-3 flex items-center justify-center text-[var(--uav-muted)] hover:text-white disabled:opacity-30 cursor-pointer"
          >
            <ChevronDown className="w-3 h-3 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
};
