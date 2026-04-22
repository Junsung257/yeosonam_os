/**
 * 별점 표시 컴포넌트
 * - 반별(0.5) 지원
 * - aria-label 로 접근성 확보
 */

interface Props {
  rating: number;               // 0~5
  size?: 'sm' | 'md' | 'lg';
  showNumber?: boolean;
  count?: number;               // 리뷰 개수
}

export default function Stars({ rating, size = 'md', showNumber = false, count }: Props) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;

  const sizeClass = {
    sm: 'text-[11px]',
    md: 'text-[14px]',
    lg: 'text-[20px]',
  }[size];

  return (
    <span className={`inline-flex items-center gap-0.5 ${sizeClass}`} aria-label={`별점 ${rating} / 5`}>
      <span className="text-amber-400">
        {'★'.repeat(full)}
        {half === 1 && '★'}
      </span>
      {empty > 0 && <span className="text-slate-300">{'★'.repeat(empty)}</span>}
      {showNumber && (
        <span className="ml-1 font-semibold text-slate-700 tabular-nums">
          {rating.toFixed(1)}
          {count !== undefined && <span className="text-slate-400 font-normal"> ({count.toLocaleString()})</span>}
        </span>
      )}
    </span>
  );
}
