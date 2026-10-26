import React from 'react';

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}

export const StatTile: React.FC<StatTileProps> = ({
  icon,
  label,
  value,
  className = '',
  valueClassName = '',
}) => {
  return (
    <div
      className={`rounded-[10px] border border-[var(--uav-card-border)] bg-[var(--uav-card)] px-3 py-2 flex items-center gap-3 select-none min-h-[58px] ${className}`}
    >
      <div className="shrink-0 flex items-center justify-center text-[var(--uav-icon-blue)]">
        {icon}
      </div>
      <div className="flex flex-col justify-center min-w-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--uav-muted)] font-sans truncate">
          {label}
        </span>
        <span
          className={`text-[16px] font-semibold text-[var(--uav-text)] font-sans leading-tight truncate ${valueClassName}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
};
