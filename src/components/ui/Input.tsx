import { InputHTMLAttributes, ReactNode, forwardRef } from 'react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  hint?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
}

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
  const base = 'w-full text-body text-text-primary placeholder:text-text-secondary bg-white border rounded-btn transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-50 disabled:text-slate-400';
  const state = error
    ? 'border-danger focus:border-danger focus:ring-danger/30'
    : 'border-slate-200 focus:border-brand focus:ring-brand/20';

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-micro font-medium text-text-primary">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {startIcon && (
          <span className="absolute left-3 flex items-center text-text-secondary pointer-events-none">
            {startIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`${base} ${state} py-2.5 ${startIcon ? 'pl-9' : 'pl-3.5'} ${endIcon ? 'pr-9' : 'pr-3.5'} ${className}`}
          {...props}
        />
        {endIcon && (
          <span className="absolute right-3 flex items-center text-text-secondary">
            {endIcon}
          </span>
        )}
      </div>
      {error && <p className="text-micro text-danger">{error}</p>}
      {hint && !error && <p className="text-micro text-text-secondary">{hint}</p>}
    </div>
  );
});

Input.displayName = 'Input';
export default Input;
