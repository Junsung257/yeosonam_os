import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  hint?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

/**
 * 컨텍스트 인식 입력.
 *  - 공개사이트: text-body / rounded-btn / py-2.5
 *  - .admin-scope: text-admin-base / rounded-admin-sm / h-9
 */
const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  error,
  hint,
  startIcon,
  endIcon,
  className = '',
  id,
  ...props
}, ref) => {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  const base = [
    'w-full text-body text-text-primary placeholder:text-text-secondary bg-white border rounded-btn transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400',
    // admin scope
    '[.admin-scope_&]:text-admin-base [.admin-scope_&]:text-admin-text [.admin-scope_&]:placeholder:text-admin-muted-2',
    '[.admin-scope_&]:bg-admin-surface [.admin-scope_&]:rounded-admin-sm [.admin-scope_&]:h-9',
    '[.admin-scope_&]:disabled:bg-admin-surface-2 [.admin-scope_&]:disabled:text-admin-muted-2',
    '[.admin-scope_&]:focus:ring-0 [.admin-scope_&]:focus:shadow-admin-focus',
  ].join(' ');
  const state = error
    ? 'border-danger focus:border-danger focus:ring-danger/30 [.admin-scope_&]:focus:shadow-admin-focus-danger'
    : 'border-slate-200 focus:border-brand focus:ring-brand/20 [.admin-scope_&]:border-admin-border-mid [.admin-scope_&]:focus:border-brand';

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-micro font-medium text-text-primary [.admin-scope_&]:text-admin-xs [.admin-scope_&]:text-admin-text-2">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {startIcon && (
          <span className="absolute left-3 flex items-center text-text-secondary [.admin-scope_&]:text-admin-muted pointer-events-none">
            {startIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`${base} ${state} py-2.5 [.admin-scope_&]:py-0 ${startIcon ? 'pl-9' : 'pl-3.5 [.admin-scope_&]:pl-3'} ${endIcon ? 'pr-9' : 'pr-3.5 [.admin-scope_&]:pr-3'} ${className}`}
          {...props}
        />
        {endIcon && (
          <span className="absolute right-3 flex items-center text-text-secondary [.admin-scope_&]:text-admin-muted">
            {endIcon}
          </span>
        )}
      </div>
      {error && <p className="text-micro text-danger [.admin-scope_&]:text-admin-xs">{error}</p>}
      {hint && !error && <p className="text-micro text-text-secondary [.admin-scope_&]:text-admin-xs [.admin-scope_&]:text-admin-muted">{hint}</p>}
    </div>
  );
});

Input.displayName = 'Input';
export default Input;
