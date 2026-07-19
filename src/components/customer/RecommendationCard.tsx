'use client';

import { useEffect, useState } from 'react';
import PairwiseCompareModal from './PairwiseCompareModal';

interface Deductions {
  hotel_premium?: number;
  flight_premium?: number;
  shopping_avoidance?: number;
  free_options?: number;
  cold_start_boost?: number;
}

interface Features {
  shopping_count: number | null;
  hotel_avg_grade: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
}

interface Rival {
  package_id: string;
  title: string;
  rank_in_group: number;
  list_price: number;
  effective_price: number;
  hotel_avg_grade: number | null;
  shopping_count: number | null;
  free_option_count: number | null;
  is_direct_flight: boolean | null;
}

interface Props {
  rankInGroup: number;
  groupSize: number;
  effectivePrice: number;
  listPrice: number;
  departureDate?: string | null;
  deductions: Deductions;
  features: Features;
  productHighlights: string[];
  socialProof?: { bookings: number; interest: number };
  packageId?: string;
  rivals?: Rival[];
  customerPicksLabel?: string;
}

function formatKrw(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '상담 후 확인';
  return `₩${Math.round(value).toLocaleString('ko-KR')}`;
}

function formatDateLabel(date?: string | null): string {
  if (!date) return '출발일 상담 가능';
  return `${date.slice(5).replace('-', '/')} 출발`;
}

function hasText(highlights: string[], pattern: RegExp): boolean {
  return highlights.some((text) => pattern.test(text));
}

function diffLine(self: { listPrice: number; features: Features; productHighlights: string[] }, rival: Rival): string {
  const parts: string[] = [];
  const priceDiff = self.listPrice - rival.list_price;

  if (priceDiff > 5000) parts.push(`가격은 약 ${Math.round(priceDiff / 10000)}만원 높지만`);
  if (priceDiff < -5000) parts.push(`가격은 약 ${Math.round(Math.abs(priceDiff) / 10000)}만원 낮고`);
  if (parts.length === 0) parts.push('가격대는 비슷하고');

  if (self.features.is_direct_flight && !rival.is_direct_flight) parts.push('직항 조건을 함께 볼 수 있어요');
  if (self.features.shopping_count === 0 && (rival.shopping_count ?? 99) > 0) parts.push('쇼핑 없는 일정이에요');

  const optionDiff = (self.features.free_option_count ?? 0) - (rival.free_option_count ?? 0);
  if (optionDiff > 0) parts.push(`포함 옵션이 ${optionDiff}개 더 많아요`);

  if (hasText(self.productHighlights, /마사지|스파/i)) parts.push('휴식 요소가 포함돼 있어요');

  return parts.slice(0, 3).join(' · ');
}

function generateHeadline(rank: number, deductions: Deductions, features: Features): string {
  const isWinner = rank === 1;
  const hasFlightMerit = (deductions.flight_premium ?? 0) > 0 || features.is_direct_flight === true;
  const noShopping = features.shopping_count === 0;
  const hasHotelMerit = (features.hotel_avg_grade ?? 0) >= 4.5;
  const optionPacked = (deductions.free_options ?? 0) > 0 || (features.free_option_count ?? 0) >= 2;

  if (isWinner) {
    if (hasFlightMerit && noShopping) return '직항과 쇼핑 없는 일정을 함께 보는 상품';
    if (hasFlightMerit && hasHotelMerit) return '항공과 호텔 조건을 함께 보는 상품';
    if (noShopping && optionPacked) return '쇼핑 부담을 줄이고 포함 조건을 보는 상품';
    if (hasFlightMerit) return '항공 조건을 먼저 비교해볼 상품';
    if (noShopping) return '쇼핑 없는 일정으로 비교해볼 상품';
    if (optionPacked) return '포함 조건을 비교해볼 상품';
    return '같은 일정에서 먼저 비교해볼 상품';
  }

  if (hasFlightMerit) return '항공 조건을 비교해볼 대안';
  if (noShopping) return '쇼핑 조건을 줄인 대안';
  if (hasHotelMerit) return '호텔 조건을 비교해볼 대안';
  if (optionPacked) return '포함 조건을 비교해볼 대안';
  return '조건을 함께 비교해볼 대안';
}

function generateChips(deductions: Deductions, features: Features, highlights: string[]): { label: string }[] {
  const chips: { label: string }[] = [];

  if ((deductions.flight_premium ?? 0) > 0 || features.is_direct_flight === true) {
    chips.push({ label: hasText(highlights, /전세기/) ? '직항 전세기' : '직항' });
  }
  if ((features.hotel_avg_grade ?? 0) >= 4.5) chips.push({ label: '호텔 조건 우수' });
  if (features.shopping_count === 0) chips.push({ label: '쇼핑 없음' });
  if (hasText(highlights, /마사지|스파/i)) chips.push({ label: '휴식 일정 포함' });
  if ((features.free_option_count ?? 0) >= 2) chips.push({ label: `포함 옵션 ${features.free_option_count}개` });

  return chips.slice(0, 4);
}

function socialProofMessage(socialProof?: { bookings: number; interest: number }): string | null {
  if (!socialProof) return null;
  if (socialProof.bookings >= 3) return `최근 30일 예약 ${socialProof.bookings}건`;
  if (socialProof.interest >= 10) return `최근 ${socialProof.interest}명이 관심을 보인 일정`;
  return null;
}

export default function RecommendationCard({
  rankInGroup,
  groupSize,
  effectivePrice,
  listPrice,
  departureDate,
  deductions,
  features,
  productHighlights,
  socialProof,
  packageId,
  rivals = [],
  customerPicksLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!packageId || groupSize < 2 || rankInGroup > 3) return;
    fetch('/api/tracking/recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: packageId,
        source: 'mobile_card',
        recommended_rank: rankInGroup,
        outcome: null,
      }),
    }).catch(() => {});
  }, [packageId, rankInGroup, groupSize]);

  if (groupSize <= 1 || rankInGroup > 3) return null;

  const isWinner = rankInGroup === 1;
  const priceGap = Math.max(0, listPrice - effectivePrice);
  const priceGapManwon = Math.round(priceGap / 10000);
  const headline = generateHeadline(rankInGroup, deductions, features);
  const chips = generateChips(deductions, features, productHighlights);
  const proof = socialProofMessage(socialProof);

  return (
    <section className="px-4 mt-4">
      <div
        className={`overflow-hidden rounded-2xl border shadow-sm ${
          isWinner
            ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-lime-50/40'
            : 'border-slate-100 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2 px-5 pb-1 pt-4">
          {isWinner && (
            <span className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-2.5 py-1 text-micro font-extrabold text-emerald-700">
              {customerPicksLabel || '여소남 추천'}
            </span>
          )}
          <span className="text-[11px] font-semibold text-slate-500">
            {formatDateLabel(departureDate)} · {groupSize}개 일정 비교 · {rankInGroup}순위
          </span>
        </div>

        <div className="px-5 pb-2 pt-1">
          <h3 className="break-keep text-[19px] font-extrabold leading-snug text-slate-900">
            {headline}
          </h3>
        </div>

        {isWinner && priceGapManwon >= 5 && (
          <div className="px-5 pb-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-micro tabular-nums text-slate-400 line-through">
                {formatKrw(listPrice)}
              </span>
              <span className="text-[24px] font-black leading-none tabular-nums text-emerald-700">
                {formatKrw(effectivePrice)}
              </span>
              <span className="text-[11px] font-bold text-slate-500">비교 기준</span>
            </div>
            <p className="mt-1 break-keep text-[13px] font-semibold text-rose-600">
              같은 출발일 비교 기준으로 약 {priceGapManwon}만원 차이가 있어요.
            </p>
          </div>
        )}

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-5 pb-3">
            {chips.map((chip) => (
              <span
                key={chip.label}
                className={`inline-flex rounded-full px-2.5 py-1 text-micro font-semibold ${
                  isWinner
                    ? 'border border-emerald-200 bg-white text-slate-800'
                    : 'bg-slate-50 text-slate-700'
                }`}
              >
                {chip.label}
              </span>
            ))}
          </div>
        )}

        {proof && (
          <div className="px-5 pb-3">
            <p className="flex items-center gap-1.5 text-micro text-slate-600">
              <span className="h-1 w-1 flex-shrink-0 rounded-full bg-emerald-500" />
              <span>{proof}</span>
            </p>
          </div>
        )}

        {rivals.length > 0 && (
          <>
            <div className="flex items-center border-t border-emerald-100/60">
              <button
                type="button"
                onClick={() => setCompareOpen(!compareOpen)}
                className="flex-1 px-5 py-3 text-left text-micro text-slate-700 transition hover:bg-white/40"
                aria-expanded={compareOpen}
              >
                <span className="font-semibold">
                  같은 출발일 다른 일정과 비교 <span className="font-normal text-slate-400">({rivals.length}개)</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="border-l border-emerald-100/60 px-3 py-3 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-50"
                aria-label="전체 비교 열기"
              >
                전체 비교
              </button>
            </div>

            {compareOpen && (
              <div className="space-y-2.5 border-t border-emerald-100/40 bg-white/60 px-5 pb-3 pt-3">
                {rivals.map((rival) => (
                  <div key={rival.package_id} className="rounded-lg bg-slate-50 px-3 py-2.5">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-500">
                        {rival.rank_in_group}순위 일정
                      </span>
                      <span className="text-micro font-extrabold tabular-nums text-slate-800">
                        {formatKrw(rival.list_price)}
                      </span>
                    </div>
                    <p className="mb-1.5 line-clamp-2 break-keep text-micro leading-snug text-slate-700">
                      {rival.title}
                    </p>
                    <p className="break-keep text-micro font-semibold leading-snug text-emerald-700">
                      이 상품은 {diffLine({ listPrice, features, productHighlights }, rival)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between border-t border-emerald-100/60 px-5 py-3 text-left text-micro text-slate-600 transition hover:bg-white/40"
          aria-expanded={open}
        >
          <span className="font-medium">어떤 기준으로 비교했나요?</span>
          <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </button>

        {open && (
          <div className="space-y-2 border-t border-emerald-100/40 bg-white/60 px-5 pb-4 pt-3 text-micro leading-relaxed text-slate-600">
            <p>
              여소남은 같은 목적지와 같은 출발일 상품을 묶어 가격, 항공, 호텔, 쇼핑, 포함 옵션을 함께 비교합니다.
            </p>
            {priceGapManwon >= 5 && (
              <p className="font-medium text-emerald-700">
                표시된 가격 차이는 현재 비교 데이터 기준입니다. 실제 가능 여부와 요금은 상담 시점에 다시 확인합니다.
              </p>
            )}
            <p className="text-[10px] text-slate-400">
              좌석, 객실, 요금은 출발일과 예약 시점에 따라 달라질 수 있습니다.
            </p>
          </div>
        )}
      </div>

      {rivals.length > 0 && packageId && (
        <PairwiseCompareModal
          self={{
            package_id: packageId,
            title: '선택한 상품',
            list_price: listPrice,
            hotel_avg_grade: features.hotel_avg_grade,
            shopping_count: features.shopping_count,
            free_option_count: features.free_option_count,
            is_direct_flight: features.is_direct_flight,
            product_highlights: productHighlights,
          }}
          rivals={rivals}
          departureDate={departureDate ?? null}
          open={modalOpen}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}
