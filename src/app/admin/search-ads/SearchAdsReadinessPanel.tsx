'use client';

import Link from 'next/link';
import {
  getSearchAdsPanelErrorMessage,
  getSearchAdsReadinessCards,
  type SearchAdsReadinessSummary,
  type SearchAdsReadinessTone,
} from './SearchAdsReadinessPanelModel';

export type { SearchAdsReadinessSummary } from './SearchAdsReadinessPanelModel';

const CHANNEL_TONE_CLASS: Record<SearchAdsReadinessTone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  bad: 'border-red-200 bg-red-50 text-red-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
};

interface SearchAdsReadinessPanelProps {
  summary: SearchAdsReadinessSummary | null;
  error: string | null;
}

export default function SearchAdsReadinessPanel({ summary, error }: SearchAdsReadinessPanelProps) {
  const cards = getSearchAdsReadinessCards(summary);

  return (
    <section className="rounded-admin-md border border-admin-border-mid bg-white p-4 shadow-admin-xs">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-admin-base font-semibold text-admin-text-2">검색광고 집행 준비 상태</h2>
          <p className="mt-1 text-admin-xs text-admin-muted">
            네이버와 구글을 분리해서 권한, 캠페인, 예산 집행 가능 여부를 확인합니다. 후보 생성과 실제 광고비 집행은 별도 단계입니다.
          </p>
        </div>
        <Link href="/admin/ad-os" className="inline-flex h-9 items-center rounded-admin-sm border border-admin-border-strong px-3 text-admin-xs font-semibold text-admin-text-2 hover:bg-admin-bg">
          Ad OS 승인/예산 보기
        </Link>
      </div>
      {error ? (
        <div className="mt-3 rounded-admin-sm border border-amber-200 bg-amber-50 p-3 text-admin-sm text-amber-800">
          {getSearchAdsPanelErrorMessage(error)}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {cards.map((card) => {
            return (
              <div key={card.channel} className="rounded-admin-sm border border-admin-border bg-admin-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-admin-sm font-semibold text-admin-text-2">
                      {card.name}
                    </p>
                    <p className="mt-1 text-admin-xs text-admin-muted">
                      {card.summary}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-admin-xs font-semibold ${CHANNEL_TONE_CLASS[card.tone]}`}>
                    {card.label}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-admin-xs bg-admin-surface-2 p-2">
                    <p className="text-[10px] font-semibold text-admin-muted">자동화</p>
                    <p className="mt-1 text-admin-xs font-bold text-admin-text-2">{card.modeLabel}</p>
                  </div>
                  <div className="rounded-admin-xs bg-admin-surface-2 p-2">
                    <p className="text-[10px] font-semibold text-admin-muted">레벨</p>
                    <p className="mt-1 text-admin-xs font-bold text-admin-text-2">{card.levelLabel}</p>
                  </div>
                  <div className="rounded-admin-xs bg-admin-surface-2 p-2">
                    <p className="text-[10px] font-semibold text-admin-muted">광고비</p>
                    <p className="mt-1 text-admin-xs font-bold text-admin-text-2">{card.spendLabel}</p>
                  </div>
                </div>
                <p className="mt-3 text-admin-xs text-admin-muted">다음 조치: {card.nextAction}</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
