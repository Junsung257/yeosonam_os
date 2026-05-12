/**
 * 교통수단 바 렌더링 컴포넌트 (공용)
 * 항공/선박/열차 3가지 모드 지원
 * pair 병합(isSingle: false) / 단일(isSingle: true) 두 가지 레이아웃 분기
 */
import type { TransportSegment } from '@/lib/transportParser';

interface Props {
  segment: TransportSegment;
}

const MODE_STYLES = {
  air:   { icon: '✈️', accent: '#3182F6', textColor: '#3182F6' },
  ship:  { icon: '🚢', accent: '#0e7490', textColor: '#0e7490' },
  train: { icon: '🚄', accent: '#b45309', textColor: '#b45309' },
} as const;

export default function TransportBar({ segment }: Props) {
  const style = MODE_STYLES[segment.mode] || MODE_STYLES.air;

  const barStyle: React.CSSProperties = {
    background: 'white',
    borderLeft: `3px solid ${style.accent}`,
    border: '0.5px solid #e5e7eb',
    borderLeftWidth: '3px',
    borderLeftColor: style.accent,
  };

  // 시간 표시 블록 (공통)
  const TimeBlock = ({ dep, arr }: { dep: string | null; arr: string | null }) => {
    if (!dep && !arr) return null;
    // 방어: dep === arr인 경우 단일 시간만 표시 (화살표 없음)
    const sameTime = !!(dep && arr && dep === arr);
    const showArrow = !!(dep && arr && !sameTime);
    return (
      <div className="flex items-center gap-1 text-slate-700 font-medium text-[12px]">
        {dep && <span>{dep}</span>}
        {showArrow && <span className="text-slate-300">→</span>}
        {arr && !sameTime && <span>{arr}</span>}
        {segment.nextDay && !sameTime && (
          <span className="text-[9px] bg-[#fef3c7] text-[#f59e0b] px-1 py-0.5 rounded font-bold">
            +1
          </span>
        )}
        {segment.durationText && (
          <span className="text-[10px] text-slate-400 font-normal ml-1">
            {segment.durationText}
          </span>
        )}
      </div>
    );
  };

  // pair 병합된 경우 (항공/열차 정상 케이스)
  if (!segment.isSingle && segment.from && segment.to) {
    return (
      <div className="rounded-r px-2.5 py-1.5 flex items-center justify-between text-[12px]" style={barStyle}>
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: style.textColor }}>
          <span>{style.icon} {segment.from} → {segment.to}</span>
          {segment.code && (
            <>
              <span className="text-slate-400 font-normal">·</span>
              <span className="text-slate-600 font-normal">{segment.code}</span>
            </>
          )}
          {segment.carrier && (
            <span className="text-slate-400 text-[10px] font-normal">({segment.carrier})</span>
          )}
        </div>
        <TimeBlock dep={segment.depTime} arr={segment.arrTime} />
      </div>
    );
  }

  // 단일 항목 (선박 또는 pair 실패)
  return (
    <div className="rounded-r px-2.5 py-1.5 flex items-center justify-between text-[12px]" style={barStyle}>
      <div className="flex items-center gap-1.5 font-semibold" style={{ color: style.textColor }}>
        <span>{style.icon} {segment.label}</span>
        {segment.code && (
          <span className="text-slate-400 text-[10px] font-normal">({segment.code})</span>
        )}
      </div>
      <TimeBlock dep={segment.depTime} arr={segment.arrTime} />
    </div>
  );
}
