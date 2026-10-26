import React from 'react';

export interface SegmentedOption<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function Segmented<T extends string = string>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
}: SegmentedProps<T>) {
  const isSm = size === 'sm';

  return (
    <div
      className={`inline-flex items-center rounded-[8px] border border-[var(--uav-card-border)] bg-[#11161D] p-[2px] gap-[2px] select-none ${className}`}
    >
      {options.map((opt) => {
        const isActive = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`flex items-center justify-center gap-1.5 rounded-[6px] font-sans transition-all cursor-pointer ${
              isSm ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-[12px]'
            } ${
              isActive
                ? 'bg-[#10B981] text-black font-bold shadow-none'
                : 'text-[var(--uav-muted)] hover:text-[var(--uav-text)] hover:bg-[#21262D]'
            }`}
          >
            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
