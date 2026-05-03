/**
 * 추천 카드 — Booking.com 5-layer 심리 프레임 (2026-04-29)
 *
 * 학술 기반:
 *  ① Authority (Cialdini)        — "✓ 여소남 픽" 큐레이션 인장 (Editor's Choice 패턴)
 *  ② Loss Aversion (Kahneman)    — "이 구성 따로 사면 +27만원" (이득 X 손실 프레임. 2.5x 강함)
 *  ③ Social Proof (Cialdini)     — "이번 달 N명 문의" (임계값 미만은 비노출)
 *  ④ Scarcity                    — 잔여 좌석 (별도 SeatBadge로 처리 — 이 카드 외부)
 *  ⑤ Anchoring (Tversky)         — 정가 취소선 → 절약액 큰 글씨
 *
 * "실효가" 단어는 프론트에서 제거. DB 컬럼명만 유지. 산식은 "어떻게 골랐나요?" 토글에만.
 *
 * 데이터 출처: package_scores (rank/effective_price/breakdown) + features + product_highlights
 */
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
  /** 사회적 증거 (Cialdini 4) — destination 단위 30일 카운트 */
  socialProof?: { bookings: number; interest: number };
  /** package_id — 추천 노출 트래킹용 */
  packageId?: string;
  /** 같은 날 다른 패키지 (pairwise 비교용) */
  rivals?: Rival[];
}

// rivals 1개를 자연어 한 줄로 합성 (pairwise diff)
function diffLine(self: { listPrice: number; features: Features; productHighlights: string[] }, rival: Rival): string {
  const priceDiff = self.listPrice - rival.list_price;
  const priceWord = priceDiff > 5000 ? `${(priceDiff / 10000).toFixed(0)}만원 더 비싸지만`
    : priceDiff < -5000 ? `${(-priceDiff / 10000).toFixed(0)}만원 더 저렴하면서`
    : '비슷한 가격에';

  const better: string[] = [];
  const sf = self.features;

  const hotelDiff = (sf.hotel_avg_grade ?? 0) - (rival.hotel_avg_grade ?? 0);
  if (hotelDiff >= 0.5) better.push(`호텔 ${sf.hotel_avg_grade}성`);
  if (sf.is_direct_flight && !rival.is_direct_flight) better.push('직항');
  if ((rival.shopping_count ?? 99) > (sf.shopping_count ?? 0)) {
    if (sf.shopping_count === 0) better.push('노쇼핑');
    else better.push(`쇼핑 ${(rival.shopping_count ?? 0) - (sf.shopping_count ?? 0)}회 적음`);
  }
  const optDiff = (sf.free_option_count ?? 0) - (rival.free_option_count ?? 0);
  if (optDiff >= 1) {
    const massage = self.productHighlights.find(h => /마사지/.test(h));
    if (massage) better.push('마사지 추가 포함');
    else better.push(`옵션 ${optDiff}개 더`);
  }

  if (better.length === 0) return `${priceWord} 비슷한 구성이에요`;
  return `${priceWord} ${better.slice(0, 2).join(' + ')} 포함이에요`;
}

// ─── 헤드라인 자동 합성 ────────────────────────────────────────────
function generateHeadline(rank: number, ded: Deductions, feat: Features): string {
  const isWinner = rank === 1;
  const flight = (ded.flight_premium ?? 0) > 0 || feat.is_direct_flight === true;
  const noShopping = feat.shopping_count === 0;
  const fiveStar = (feat.hotel_avg_grade ?? 0) >= 4.5;
  const optionPacked = (ded.free_options ?? 0) > 0 || (feat.free_option_count ?? 0) >= 2;

  if (isWinner) {
    if (flight && fiveStar) return '직항에 5성인데 이 일정 최저가';
    if (flight && noShopping) return '직항 노쇼핑인데 이 일정 최저가';
    if (fiveStar && noShopping) return '5성급 노쇼핑인데 이 일정 최저가';
    if (flight) return '직항인데 이 일정 최저가';
    if (noShopping) return '노쇼핑인데 이 일정 최저가';
    if (fiveStar) return '5성급인데 이 일정 최저가';
    if (optionPacked) return '옵션 포함인데 이 일정 최저가';
    return '이 출발일 최고 가성비 구성';
  }
  if (flight && fiveStar) return '직항·5성 가치가 큰 옵션';
  if (flight) return '직항 가치가 큰 옵션';
  if (noShopping) return '노쇼핑 구성으로 부담 적은 옵션';
  if (fiveStar) return '5성급 가치가 큰 옵션';
  if (optionPacked) return '옵션까지 포함된 풍부한 구성';
  return '동급 대비 강점이 있는 옵션';
}

// ─── 칩 4개 자동 매핑 ──────────────────────────────────────────────
function generateChips(ded: Deductions, feat: Features, highlights: string[]): { icon: string; label: string }[] {
  const chips: { icon: string; label: string }[] = [];
  if ((ded.flight_premium ?? 0) > 0 || feat.is_direct_flight === true) {
    const isCharter = highlights.some(h => /전세기/.test(h));
    chips.push({ icon: '✈️', label: isCharter ? '직항 전세기' : '직항' });
  }
  if ((feat.hotel_avg_grade ?? 0) >= 4.5) chips.push({ icon: '🏨', label: '5성급 호텔' });
  if (feat.shopping_count === 0) chips.push({ icon: '🛍️', label: '쇼핑 없음' });
  const massage = highlights.find(h => /마사지/.test(h));
  if (massage) {
    const m = massage.match(/(전신|발|풋|아로마)?\s*마사지\s*(\d+분)?/);
    chips.push({ icon: '💆', label: m && m[2] ? `마사지 ${m[2]}` : '마사지 포함' });
  } else if ((feat.free_option_count ?? 0) >= 2) {
    chips.push({ icon: '💎', label: '옵션 포함' });
  }
  return chips.slice(0, 4);
}

// ─── 사회적 증거 메시지 (임계값 미만 비노출) ──────────────────────
function socialProofMessage(sp?: { bookings: number; interest: number }): string | null {
  if (!sp) return null;
  if (sp.bookings >= 3) return `최근 30일 ${sp.bookings}건 예약`;       // 가장 강함
  if (sp.interest >= 10) return `최근 한 달 ${sp.interest}명이 같은 일정 관심`;
  return null; // false signal 방지
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────
export default function RecommendationCard({
  rankInGroup, groupSize, effectivePrice, listPrice, departureDate,
  deductions, features, productHighlights, socialProof, packageId, rivals = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // 노출 트래킹 — recommendation_outcomes 자동 누적 (LTR ground truth)
  useEffect(() => {
    if (!packageId || groupSize < 2 || rankInGroup > 3) return;
    fetch('/api/tracking/recommendation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        package_id: packageId,
        source: 'mobile_card',
        recommended_rank: rankInGroup,
        outcome: null, // 노출만 (클릭 시 별도 호출)
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageId, rankInGroup, groupSize]);

  if (groupSize <= 1) return null;
  if (rankInGroup > 3) return null;

  const isWinner = rankInGroup === 1;
  const totalSavings = Math.max(0, listPrice - effectivePrice);
  const savingsManwon = Math.round(totalSavings / 10000);

  const headline = generateHeadline(rankInGroup, deductions, features);
  const chips = generateChips(deductions, features, productHighlights);
  const proof = socialProofMessage(socialProof);
  const dateLabel = departureDate ? `${departureDate.slice(5).replace('-', '/')} 출발` : '같은 일정';

  return (
    <section className="px-4 mt-4">
      <div className={`rounded-2xl overflow-hidden border ${
        isWinner
          ? 'bg-gradient-to-br from-emerald-50 to-lime-50/40 border-emerald-200 shadow-sm'
          : 'bg-white border-gray-100 shadow-sm'
      }`}>
        {/* ① Authority — 여소남 픽 인장 + 순위 컨텍스트 */}
        <div className="px-5 pt-4 pb-1 flex items-center gap-2 flex-wrap">
          {isWinner && (
            <span className="inline-flex items-center gap-1 text-[12px] font-extrabold text-emerald-700 bg-white border border-emerald-300 px-2.5 py-1 rounded-full">
              <span className="text-emerald-600">✓</span>
              <span>여소남 픽</span>
            </span>
          )}
          <span className="text-[11px] font-semibold text-gray-500">
            {dateLabel} · {groupSize}개 비교 {rankInGroup}위
          </span>
        </div>

        {/* 강력 헤드라인 */}
        <div className="px-5 pt-1 pb-2">
          <h3 className="text-[19px] font-extrabold text-gray-900 leading-snug break-keep">
            {headline}
          </h3>
        </div>

        {/* ⑤ Anchoring + ② Loss Aversion */}
        {isWinner && savingsManwon >= 5 && (
          <div className="px-5 pb-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[12px] text-gray-400 line-through tabular-nums">
                ₩{listPrice.toLocaleString()}
              </span>
              <span className="text-[24px] font-black text-emerald-700 tabular-nums leading-none">
                ₩{effectivePrice.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold text-gray-500">상당</span>
            </div>
            <p className="text-[13px] text-rose-600 font-semibold mt-1 break-keep">
              💸 이 구성 따로 사면 <span className="text-[14px] font-extrabold">+{savingsManwon}만원</span> 더 들어요
            </p>
          </div>
        )}

        {/* 칩 4개 (스캔용) */}
        {chips.length > 0 && (
          <div className="px-5 pb-3 flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-full ${
                isWinner ? 'bg-white text-gray-800 border border-emerald-200' : 'bg-gray-50 text-gray-700'
              }`}>
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </span>
            ))}
          </div>
        )}

        {/* ③ Social Proof — 임계값 충족 시만 */}
        {proof && (
          <div className="px-5 pb-3">
            <p className="text-[12px] text-gray-600 flex items-center gap-1.5">
              <span className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
              <span>{proof}</span>
            </p>
          </div>
        )}

        {/* "다른 옵션과 비교" 토글 + 풀 모달 버튼 */}
        {rivals.length > 0 && (
          <>
            <div className="flex items-center border-t border-emerald-100/60">
              <button
                type="button"
                onClick={() => setCompareOpen(!compareOpen)}
                className="flex-1 px-5 py-3 text-left flex items-center justify-between text-[12px] text-gray-700 hover:bg-white/40 transition"
                aria-expanded={compareOpen}
              >
                <span className="font-semibold">
                  같은 날 다른 옵션과 비교 <span className="text-gray-400 font-normal">({rivals.length}개)</span>
                </span>
                <span className={`transition-transform text-gray-400 ${compareOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="px-3 py-3 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 transition border-l border-emerald-100/60"
                aria-label="풀 비교 표 열기"
              >
                풀 비교 ↗
              </button>
            </div>
            {compareOpen && (
              <div className="px-5 pb-3 border-t border-emerald-100/40 bg-white/60 space-y-2.5 pt-3">
                {rivals.map(r => {
                  const line = diffLine({ listPrice, features, productHighlights }, r);
                  return (
                    <div key={r.package_id} className="rounded-lg bg-gray-50 px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-[11px] font-bold text-gray-500">
                          {r.rank_in_group}위 옵션
                        </span>
                        <span className="text-[12px] font-extrabold text-gray-800 tabular-nums">
                          ₩{r.list_price.toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[12px] text-gray-700 leading-snug break-keep mb-1.5 line-clamp-2">
                        {r.title}
                      </p>
                      <p className="text-[12px] text-emerald-700 font-semibold leading-snug break-keep">
                        💡 이 1위 패키지가 {line}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* "어떻게 골랐나요?" 토글 — 큐레이션 스토리 */}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full px-5 py-3 text-left flex items-center justify-between border-t border-emerald-100/60 text-[12px] text-gray-600 hover:bg-white/40 transition"
          aria-expanded={open}
        >
          <span className="font-medium">어떻게 골랐나요?</span>
          <span className={`transition-transform text-gray-400 ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {open && (
          <div className="px-5 pb-4 border-t border-emerald-100/40 bg-white/60 text-[12px] text-gray-600 leading-relaxed space-y-2 pt-3">
            <p>
              여소남이 같은 목적지·같은 출발일 패키지를 모아 <strong>호텔 등급·직항·옵션 포함·쇼핑 횟수·랜드사 신뢰도</strong>를 종합적으로 비교해요.
            </p>
            {savingsManwon >= 5 && (
              <p className="text-emerald-700 font-medium">
                이 패키지는 정가 ₩{listPrice.toLocaleString()} 안에 약 <strong>{savingsManwon}만원</strong>치의
                셀링포인트 (호텔·직항·옵션 등)가 포함된 셈이에요. 따로 구성하면 더 비싸집니다.
              </p>
            )}
            <p className="text-[10px] text-gray-400 mt-2">
              ※ 매일 새벽 자동 재계산 · 정책 v1 (학술적으로 검증된 헤도닉 + TOPSIS 결합)
            </p>
          </div>
        )}
      </div>

      {/* 풀 비교 모달 */}
      {rivals.length > 0 && packageId && (
        <PairwiseCompareModal
          self={{
            package_id: packageId,
            title: '이 패키지',
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
