import type { ReactNode } from 'react';

type ChipVariant = 'primary' | 'ghost' | 'warning' | 'success' | 'danger';

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  primary: 'bg-brand-light text-brand',
  ghost:   'bg-slate-100 text-slate-600',
  warning: 'bg-warning-light text-warning',
  success: 'bg-success-light text-success',
  danger:  'bg-danger-light text-danger',
};

interface ChipProps {
  variant?: ChipVariant;
  children: ReactNode;
  className?: string;
}

export default function Chip({ variant = 'primary', children, className = '' }: ChipProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
