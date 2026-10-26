import React from 'react';

interface CardProps {
  title?: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  className?: string;
  contentClassName?: string;
  headerClassName?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({
  title,
  action,
  collapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  className = '',
  contentClassName = '',
  headerClassName = '',
  children,
}) => {
  return (
    <div
      className={`rounded-[10px] border border-[var(--uav-card-border)] bg-[var(--uav-card)] overflow-hidden flex flex-col shadow-none ${className}`}
    >
      {title && (
        <div
          className={`flex items-center justify-between px-3 py-2 border-b border-[var(--uav-card-border)] shrink-0 select-none ${headerClassName}`}
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--uav-text)] font-sans">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {action}
            {collapsible && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                className="w-5 h-5 flex items-center justify-center rounded text-[var(--uav-muted)] hover:text-[var(--uav-text)] transition cursor-pointer"
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`transition-transform duration-200 ${isCollapsed ? 'rotate-180' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      {!isCollapsed && <div className={`flex-1 overflow-hidden ${contentClassName}`}>{children}</div>}
    </div>
  );
};
