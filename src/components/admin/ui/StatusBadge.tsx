/**
 * StatusBadge — 어드민 ERP 상태 배지의 단일 진입점
 *
 * kind:
 *   - 'booking' : 예약 상태 (booking-state-machine.ts)
 *   - 'package' : 상품 상태 (package-status.ts)
 *   - 'audit'   : 감사 게이트 결과 (package-status.ts)
 *   - 'grade'   : 고객 등급 (mileage.ts)
 *   - 'custom'  : tone prop 으로 직접 지정
 */

import { getStatusBadgeClass, getStatusLabel } from '@/lib/booking-state-machine';
import { GRADE_STYLE } from '@/lib/mileage';
import {
  PACKAGE_STATUS_BADGE,
  PACKAGE_STATUS_LABEL,
  AUDIT_BADGE,
} from '@/lib/package-status';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type StatusKind = 'booking' | 'package' | 'audit' | 'grade' | 'custom';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'bg-status-successBg text-status-successFg',
  warning: 'bg-status-warningBg text-status-warningFg',
  danger:  'bg-status-dangerBg text-status-dangerFg',
  info:    'bg-status-infoBg text-status-infoFg',
  neutral: 'bg-status-neutralBg text-status-neutralFg',
};

const SIZE_CLASS = {
  sm: 'px-1.5 py-0.5 text-admin-xs',
  md: 'px-2 py-0.5 text-admin-xs',
  lg: 'px-2.5 py-1 text-admin-sm',
} as const;

interface StatusBadgeProps {
  kind: StatusKind;
  value: string;
  /** kind='custom' 일 때 필수 */
  tone?: StatusTone;
  /** 표시 라벨 override (없으면 kind별 기본 라벨) */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  withDot?: boolean;
  title?: string;
  className?: string;
}

export function StatusBadge({
  kind,
  value,
  tone,
  label,
  size = 'md',
  withDot = false,
  title,
  className = '',
}: StatusBadgeProps) {
  let colorCls = '';
  let displayLabel = label ?? value;
  let displayTitle = title;

  switch (kind) {
    case 'booking':
      colorCls = getStatusBadgeClass(value);
      if (!label) displayLabel = getStatusLabel(value);
      break;
    case 'package':
      colorCls = PACKAGE_STATUS_BADGE[value] ?? TONE_CLASS.neutral;
      if (!label) displayLabel = PACKAGE_STATUS_LABEL[value] ?? value;
      break;
    case 'audit': {
      const cfg = AUDIT_BADGE[value];
      if (cfg) {
        colorCls = cfg.cls;
        if (!label) displayLabel = cfg.label;
        if (!title) displayTitle = cfg.title;
      } else {
        colorCls = TONE_CLASS.neutral;
      }
      break;
    }
    case 'grade': {
      const style = GRADE_STYLE[value];
      colorCls = style?.badge ?? TONE_CLASS.neutral;
      break;
    }
    case 'custom':
      colorCls = TONE_CLASS[tone ?? 'neutral'];
      break;
  }

  return (
    <span
      title={displayTitle}
      className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap ${SIZE_CLASS[size]} ${colorCls} ${className}`}
    >
      {withDot && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
      {displayLabel}
    </span>
  );
}

export default StatusBadge;
