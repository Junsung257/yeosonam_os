import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize    = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

/**
 * 컨텍스트 인식 버튼.
 *  - 공개사이트: Toss 톤 (rounded-btn 12px, text-body)
 *  - .admin-scope 안: Linear/Stripe 톤 (rounded-admin-sm 6px, text-admin-base, h-9)
 * Tailwind 3.1+ 의 [.admin-scope_&]: 임의 부모 선택자로 분기.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: [
    'bg-brand text-white hover:bg-brand-dark active:bg-brand-dark',
    'disabled:bg-slate-200 disabled:text-slate-400',
    '[.admin-scope_&]:disabled:bg-admin-border-mid [.admin-scope_&]:disabled:text-admin-muted-2',
  ].join(' '),
  secondary: [
    'bg-brand-light text-brand hover:bg-blue-100 active:bg-blue-100',
    'disabled:bg-slate-100 disabled:text-slate-400',
    // 어드민에선 outline 버튼처럼 (Linear secondary)
    '[.admin-scope_&]:bg-admin-surface [.admin-scope_&]:text-admin-text',
    '[.admin-scope_&]:border [.admin-scope_&]:border-admin-border-mid',
    '[.admin-scope_&]:hover:bg-admin-surface-2 [.admin-scope_&]:hover:border-admin-border-strong',
    '[.admin-scope_&]:disabled:bg-admin-border [.admin-scope_&]:disabled:text-admin-muted-2',
  ].join(' '),
  ghost: [
    'bg-transparent text-text-body hover:bg-slate-100 active:bg-slate-100',
    'disabled:text-slate-300',
    '[.admin-scope_&]:text-admin-text-2 [.admin-scope_&]:hover:bg-admin-surface-2',
    '[.admin-scope_&]:hover:text-admin-text [.admin-scope_&]:disabled:text-admin-muted-2',
  ].join(' '),
  danger: [
    'bg-danger text-white hover:bg-red-600 active:bg-red-600',
    'disabled:bg-slate-200 disabled:text-slate-400',
    '[.admin-scope_&]:disabled:bg-admin-border-mid [.admin-scope_&]:disabled:text-admin-muted-2',
  ].join(' '),
};

const SIZE: Record<ButtonSize, string> = {
  sm: [
    'px-3 py-1.5 text-micro rounded-lg gap-1.5',
    '[.admin-scope_&]:h-8 [.admin-scope_&]:px-2.5 [.admin-scope_&]:py-0',
    '[.admin-scope_&]:text-admin-sm [.admin-scope_&]:rounded-admin-sm',
  ].join(' '),
  md: [
    'px-4 py-2.5 text-body rounded-btn gap-2',
    '[.admin-scope_&]:h-9 [.admin-scope_&]:px-3.5 [.admin-scope_&]:py-0',
    '[.admin-scope_&]:text-admin-base [.admin-scope_&]:rounded-admin-sm',
  ].join(' '),
  lg: [
    'px-6 py-3.5 text-body font-semibold rounded-btn gap-2',
    '[.admin-scope_&]:h-11 [.admin-scope_&]:px-4 [.admin-scope_&]:py-0',
    '[.admin-scope_&]:text-admin-base [.admin-scope_&]:rounded-admin-sm',
  ].join(' '),
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
      className={`inline-flex items-center justify-center font-medium transition-colors duration-160 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [.admin-scope_&]:focus-visible:shadow-admin-focus [.admin-scope_&]:focus-visible:ring-0 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
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
