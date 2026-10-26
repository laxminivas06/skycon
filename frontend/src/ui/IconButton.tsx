import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  title?: string;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'active';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  title,
  variant = 'default',
  size = 'md',
  active = false,
  className = '',
  disabled = false,
  ...props
}) => {
  const sizeClasses = {
    sm: 'w-7 h-7 text-[13px]',
    md: 'w-8 h-8 text-[15px]',
    lg: 'w-9 h-9 text-[17px]',
  }[size];

  const variantClasses = {
    default: 'border border-[var(--uav-card-border)] bg-[#111C30] text-[var(--uav-muted)] hover:text-white hover:bg-[#1A2A46]',
    primary: 'border border-[var(--uav-primary-blue)] bg-[var(--uav-primary-blue)] text-white hover:bg-blue-600',
    danger: 'border border-[var(--uav-red-border)] bg-[var(--uav-red-dark)] text-red-300 hover:bg-red-900',
    ghost: 'border-transparent bg-transparent text-[var(--uav-muted)] hover:text-white hover:bg-[#142036]',
    active: 'border border-[var(--uav-primary-blue)] bg-[var(--uav-primary-blue)] text-white shadow-none',
  }[active ? 'active' : variant];

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-[8px] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};
