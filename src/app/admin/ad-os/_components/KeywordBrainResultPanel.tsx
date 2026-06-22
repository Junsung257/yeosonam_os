import { fmtWon } from '../_lib/display';
import { StatusPill } from './StatusPill';

export function KeywordBrainResultPanel({ result }: { result: Record<string, unknown> | null }) {
  if (!result) return null;

  const candidates = (result.candidates || []) as Array<Record<string, unknown>>;
  const summary = result.summary as Record<string, number> | undefined;

  return (
    <div className="mt-3 rounded-admin-sm border border-admin-border bg-admin-surface-2 p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-admin-sm font-semibold text-admin-text">키워드 브레인 결과</p>
          <p className="mt-1 text-admin-2xs text-admin-muted">
            상품 정보, 검색어, 낭비 제외어, 롱테일 묶음을 광고 키워드 초안으로 정리합니다.
          </p>
        </div>
        <StatusPill tone="good">
          후보 {Number(summary?.candidates || 0).toLocaleString('ko-KR')}개
        </StatusPill>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {candidates.slice(0, 9).map((candidate) => (
          <div key={`${String(candidate.keyword)}-${String(candidate.matchType)}`} className="rounded-admin-xs border border-admin-border bg-admin-surface px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-admin-xs font-semibold text-admin-text">{String(candidate.keyword || '-')}</p>
              <StatusPill tone={candidate.tier === 'negative' ? 'bad' : Number(candidate.score || 0) >= 70 ? 'good' : 'neutral'}>
                {String(candidate.tier || '-')}
              </StatusPill>
            </div>
            <p className="mt-1 text-admin-2xs text-admin-muted">
              {String(candidate.intent || '-')} - {String(candidate.matchType || '-')} - {fmtWon(Number(candidate.suggestedBidKrw || 0))}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
