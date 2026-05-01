'use client';

import { KPI_BASIS_OPTIONS, type KPIBasis } from '@/lib/kpi-basis';

/**
 * KPI 산식 기준 토글 — "예약 기준 / 매출 인식 기준" 양자 택일.
 *
 * 사용 패턴:
 *   const [basis, setBasis] = useState<KPIBasis>('commission');
 *   <KPIBasisToggle value={basis} onChange={setBasis} />
 *
 * 배경: ERR-affiliate-analytics-basis@2026-04-28 — 같은 페이지의 매출/수수료를
 * 두 회계 관점(어필리에이트 정산 정책 / IFRS 15)에서 모두 확인 필요.
 */
export default function KPIBasisToggle({
  value,
  onChange,
  size = 'md',
}: {
  value: KPIBasis;
  onChange: (next: KPIBasis) => void;
  size?: 'sm' | 'md';
}) {
  const padding = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-[12px]';
  return (
    <div className="inline-flex bg-slate-100 rounded-md p-0.5" role="tablist" aria-label="KPI 산식 기준">
      {KPI_BASIS_OPTIONS.map(opt => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            title={opt.description}
            className={`${padding} rounded font-medium transition-colors ${
              active
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
