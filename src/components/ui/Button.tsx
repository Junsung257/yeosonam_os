import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:   'bg-brand text-white hover:bg-brand-dark active:bg-brand-dark disabled:bg-slate-200 disabled:text-slate-400',
  secondary: 'bg-brand-light text-brand hover:bg-blue-100 active:bg-blue-100 disabled:bg-slate-100 disabled:text-slate-400',
  ghost:     'bg-transparent text-text-body hover:bg-slate-100 active:bg-slate-100 disabled:text-slate-300',
  danger:    'bg-danger text-white hover:bg-red-600 active:bg-red-600 disabled:bg-slate-200 disabled:text-slate-400',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-micro rounded-lg gap-1.5',
  md: 'px-4 py-2.5 text-body rounded-btn gap-2',
  lg: 'px-6 py-3.5 text-body font-semibold rounded-btn gap-2',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
