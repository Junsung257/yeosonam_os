/**
 * AlertIndicator — 행 좌측 알림 슬롯 (40px) 단일 진입점
 *
 * 기존: bookings 테이블에서 빨간 물방울/노란 삼각형이 텍스트 셀 안에 인라인 → 시각 노이즈
 * 개선: 별도 alert 컬럼으로 분리, 아이콘만 노출
 */

import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

export type AlertLevel = 'critical' | 'warning' | 'info' | 'ok';

interface AlertIndicatorProps {
  level: AlertLevel;
  tooltip?: string;
  size?: number;
}

const LEVEL_MAP = {
  critical: { Icon: AlertCircle,    cls: 'text-red-500'    },
  warning:  { Icon: AlertTriangle,  cls: 'text-amber-500'  },
  info:     { Icon: Info,           cls: 'text-blue-500'   },
  ok:       { Icon: CheckCircle2,   cls: 'text-emerald-500' },
} as const;

export function AlertIndicator({ level, tooltip, size = 16 }: AlertIndicatorProps) {
  const { Icon, cls } = LEVEL_MAP[level];
  return (
    <span
      className={`inline-flex items-center justify-center ${cls}`}
      title={tooltip}
      aria-label={tooltip ?? level}
    >
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}

export default AlertIndicator;
