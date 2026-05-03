import type { ReactNode } from 'react';

type ChipVariant = 'primary' | 'ghost' | 'warning' | 'success' | 'danger';

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  primary: 'bg-[#EBF3FE] text-[#3182F6]',
  ghost:   'bg-gray-100 text-gray-600',
  warning: 'bg-orange-50 text-orange-700',
  success: 'bg-green-50 text-green-700',
  danger:  'bg-red-50 text-red-600',
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
