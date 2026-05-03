/**
 * 여행 적합도 카드 (모바일 hero/가격카드 바로 아래에 배치)
 *
 * 표시 정보:
 *  - 출발 평균월의 적합도 점수(2-라인) + 감성 카피 + key_concern
 *  - 핵심 메트릭 4개를 "여행자 체감 언어"로 변환 (예: "낮엔 반팔, 아침저녁엔 얇은 겉옷")
 *  - 12개월 mini bar (현재 선택된 달 강조) — 탭하면 다른 달 미리보기
 *  - 추이 그래프 한 줄 자동 요약 (peak / off-season 인사이트)
 *  - 시즌 칩 → "이 시즌 패키지 보기" CTA
 *
 * 데이터 출처: destination_climate (DB) + travel-fitness-score.ts + seasonal-signals.ts
 */
'use client';

import { useState } from 'react';
import type { FitnessScore, MonthlyNormal } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';

interface Props {
  destination: string;
  primaryCity: string;
  country: string | null;
  monthlyNormals: MonthlyNormal[];
  fitnessScores: FitnessScore[];
  /** 한국인 인기도 시그널 (Naver DataLab + Wikipedia). null = 시즌 데이터 없음 */
  seasonalSignals: SeasonalSignal[] | null;
  /** 이 패키지의 대표 출발월 (1-12). 없으면 현재 월 */
  representativeMonth: number;
  /** 출발월 분포 (월→횟수) — 여러 달이면 보조 월도 표시 */
  departureDistribution?: Record<number, number>;
}

const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function scoreColor(score: number): string {
  if (score >= 85) return 'bg-emerald-500';
  if (score >= 70) return 'bg-lime-500';
  if (score >= 55) return 'bg-amber-400';
  if (score >= 40) return 'bg-orange-400';
  return 'bg-rose-400';
}

function scoreTextColor(score: number): string {
  if (score >= 85) return 'text-emerald-600';
  if (score >= 70) return 'text-lime-600';
  if (score >= 55) return 'text-amber-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-rose-600';
}

// ─── 체감 카피 헬퍼 (날씨 데이터 → 여행자 관점 한 줄) ──────────────

function tempCopy(tempMean: number): string {
  if (tempMean <= 5) return '한겨울 옷차림 — 패딩·장갑 필수';
  if (tempMean <= 12) return '두꺼운 코트·니트가 적당해요';
  if (tempMean <= 17) return '봄가을 옷차림 — 가디건·자켓';
  if (tempMean <= 22) return '낮엔 가벼운 긴팔, 저녁엔 가디건';
  if (tempMean <= 27) return '낮엔 반팔, 아침저녁엔 얇은 겉옷';
  if (tempMean <= 32) return '반팔·반바지 + 모자·선크림';
  return '한낮 더위 주의 — 실내 위주 일정 권장';
}

function rainCopy(rainDays: number): string {
  // 표시되는 정수값과 임계값 일치 (Math.round 적용)
  const r = Math.round(rainDays);
  if (r <= 2) return '거의 비 안 와요 ☀️';
  if (r <= 5) return '비 오는 날은 손에 꼽아요';
  if (r <= 9) return '한 달 중 사흘에 한 번꼴 — 우산 챙기기';
  if (r <= 15) return '절반가량 비 — 우산·방수 신발 필수';
  return '우기 시즌 — 짧은 스콜 자주, 실내 일정 병행하면 OK';
}

function humidityCopy(humidity: number): string {
  if (humidity <= 40) return '매우 건조 — 보습 화장품 챙기세요';
  if (humidity <= 55) return '한국보다 건조 — 피부 관리 신경';
  if (humidity <= 70) return '한국과 비슷한 쾌적도';
  if (humidity <= 80) return '약간 습함 — 땀이 잘 안 마름';
  return '열대 습도 — 통풍 좋은 얇은 옷 추천, 에어컨·수영장이 반가운 날씨';
}

function crowdCopy(month: number, popularity?: number): string {
  // popularity_score 우선, 없으면 한국 캘린더 기반 폴백
  if (popularity !== undefined) {
    if (popularity >= 85) return '최성수기 — 호텔·식당 미리 예약';
    if (popularity >= 70) return '인기 시즌 — 인기 코스 예약 추천';
    if (popularity >= 50) return '여유 있게 즐길 수 있어요';
    return '한적 — 가격도 저렴해요';
  }
  const peak = { 1:8, 2:5, 3:5, 4:6, 5:7, 6:5, 7:9, 8:9, 9:5, 10:7, 11:4, 12:8 }[month] ?? 5;
  if (peak >= 8) return '한국 성수기 — 가격↑ 혼잡↑';
  if (peak >= 6) return '준성수기 — 적당한 인기';
  return '비수기 — 한적·저렴';
}

// ─── 적합도 점수 + 감성 카피 ───────────────────────────────────────

function climateCaption(score: number, keyConcern: string | null): string {
  if (score >= 85) return '날씨가 가장 완벽한 시즌이에요';
  if (score >= 70) {
    return keyConcern ? `대체로 좋은 날씨 (${keyConcern.replace(/ ?[☔☀️🥶💧]/g, '').trim()})` : '대체로 쾌적한 날씨';
  }
  if (score >= 55) {
    return keyConcern ? `${keyConcern.replace(/ ?[☔☀️🥶💧]/g, '').trim()} 대비만 하면 충분히 즐길 수 있어요` : '평범한 수준 — 챙겨가면 충분히 즐길 수 있어요';
  }
  if (score >= 40) {
    return keyConcern ? `${keyConcern.replace(/ ?[☔☀️🥶💧]/g, '').trim()} 주의 — 옷차림 신경` : '날씨 변동 주의';
  }
  return '날씨가 험한 시기 — 일정·옷차림 신중히';
}

function popularityCaption(score: number): string {
  if (score >= 90) return '한국인이 가장 많이 찾는 바로 그 시즌';
  if (score >= 75) return '한국인 검색·예약이 활발한 시기';
  if (score >= 60) return '꾸준히 인기 있는 시즌';
  if (score >= 45) return '평균적인 수요';
  if (score >= 30) return '비수기 — 호텔·항공 가격 ↓';
  return '비수기 — 가장 저렴한 시기';
}

// ─── 추이 그래프 한 줄 요약 ────────────────────────────────────────

function chartSummary(
  fitnessScores: FitnessScore[],
  signals: SeasonalSignal[] | null,
  representativeMonth: number,
): string {
  // 출발월의 climate / popularity
  const repFit = fitnessScores.find(f => f.month === representativeMonth);
  const repSig = signals?.find(s => s.month === representativeMonth);
  if (!repFit) return '';

  const climate = repFit.score;
  const pop = repSig?.popularity_score;

  // 가장 인기 있는 달 찾기 (popularity 기준, 없으면 climate)
  const peakMonth = signals
    ? signals.reduce((a, b) => a.popularity_score > b.popularity_score ? a : b).month
    : fitnessScores.reduce((a, b) => a.score > b.score ? a : b).month;
  const peakIsRep = peakMonth === representativeMonth;

  if (peakIsRep && pop !== undefined && pop >= 75) {
    if (climate >= 70) return `${MONTHS[representativeMonth - 1]}이 한국인 최성수기. 날씨도 좋아 만족도 높아요.`;
    if (climate >= 50) return `${MONTHS[representativeMonth - 1]}이 한국인 최성수기. 날씨는 평범하지만 여행 만족도 높음.`;
    return `${MONTHS[representativeMonth - 1]}이 한국인 최성수기. 날씨는 험해도 여행 매력 충분.`;
  }
  if (pop !== undefined && pop >= 75) {
    return `${MONTHS[representativeMonth - 1]} 출발 — 한국인 인기 시즌이에요 (peak ${MONTHS[peakMonth - 1]}).`;
  }
  if (pop !== undefined && pop < 45) {
    return `${MONTHS[representativeMonth - 1]} 출발 — 비수기라 한적·저렴 (peak는 ${MONTHS[peakMonth - 1]}).`;
  }
  if (climate >= 70) {
    return `${MONTHS[representativeMonth - 1]} 출발 — 날씨 적합도가 좋은 시기.`;
  }
  return `${MONTHS[representativeMonth - 1]} 출발 — 극성수기 피해 여유롭고 가격 합리적인 스마트 타이밍이에요.`;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────

export default function TravelFitnessCard({
  destination, primaryCity, country, monthlyNormals, fitnessScores,
  seasonalSignals, representativeMonth, departureDistribution,
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState(representativeMonth);

  const sel = fitnessScores.find(f => f.month === selectedMonth) || fitnessScores[0];
  const norm = monthlyNormals.find(m => m.month === selectedMonth) || monthlyNormals[0];
  const sig = seasonalSignals?.find(s => s.month === selectedMonth) ?? null;
  if (!sel || !norm) return null;

  const isRepMonth = selectedMonth === representativeMonth;
  const displayCity = primaryCity || destination;
  const summary = chartSummary(fitnessScores, seasonalSignals, representativeMonth);

  return (
    <section className="px-4 mt-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {/* 헤더 — 한 줄 컴팩트 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 gap-2">
          <h3 className="text-base font-extrabold text-gray-900 truncate">
            🌤️ {MONTHS[selectedMonth - 1]} 여행 적합도 — {displayCity}
          </h3>
          {!isRepMonth && (
            <button
              onClick={() => setSelectedMonth(representativeMonth)}
              className="text-[11px] text-violet-600 underline flex-shrink-0"
            >
              출발월로
            </button>
          )}
        </div>

        {/* 2-라인 점수 + 감성 카피 */}
        <div className="px-5 py-3 space-y-2.5">
          {/* ① 날씨 적합도 */}
          <div className="flex items-end gap-3">
            <div className="flex items-baseline gap-1 w-24 flex-shrink-0">
              <span className="text-xs text-gray-400 mr-1">⛅</span>
              <span className={`text-[28px] font-black leading-none ${scoreTextColor(sel.score)}`}>{sel.score}</span>
            </div>
            <div className="flex-1 pb-0.5 min-w-0">
              <p className="text-[11px] text-gray-500 font-medium">날씨 적합도</p>
              <p className={`text-sm font-bold ${scoreTextColor(sel.score)} leading-snug`}>
                {sel.label}
              </p>
              <p className="text-[12px] text-gray-500 leading-snug mt-0.5 break-keep">
                {climateCaption(sel.score, sel.key_concern)}
              </p>
            </div>
          </div>

          {/* ② 한국인 인기도 */}
          {sig && (
            <div className="flex items-end gap-3 pt-2.5 border-t border-gray-50">
              <div className="flex items-baseline gap-1 w-24 flex-shrink-0">
                <span className="text-xs text-gray-400 mr-1">🇰🇷</span>
                <span className={`text-[28px] font-black leading-none ${scoreTextColor(sig.popularity_score)}`}>{sig.popularity_score}</span>
              </div>
              <div className="flex-1 pb-0.5 min-w-0">
                <p className="text-[11px] text-gray-500 font-medium">한국인 인기도</p>
                <p className={`text-sm font-bold ${scoreTextColor(sig.popularity_score)} leading-snug`}>
                  {sig.label}
                </p>
                <p className="text-[12px] text-gray-500 leading-snug mt-0.5 break-keep">
                  {popularityCaption(sig.popularity_score)}
                </p>
              </div>
            </div>
          )}

          {/* 충돌 멘트 — climate 낮은데 인기 있음 */}
          {sig && sel.score < 45 && sig.popularity_score >= 60 && (
            <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 mt-1">
              <p className="text-[12px] text-violet-700 font-medium">
                💬 날씨는 험해도 한국인이 많이 찾는 시즌이에요{sig.badge ? ` · ${sig.badge}` : ''}
              </p>
            </div>
          )}

          {/* 일반 시즌 칩은 제거 (혼동 방지). 충돌 멘트는 위에서 유지 */}
        </div>

        {/* 핵심 메트릭 4개 — 여행자 체감 언어 */}
        <div className="px-5 py-3 border-t border-gray-50 space-y-2">
          <MetricLine icon="🌡️" label="기온" value={`${Math.round(norm.temp_mean)}° (${Math.round(norm.temp_min)}~${Math.round(norm.temp_max)}°)`} copy={tempCopy(norm.temp_mean)} />
          <MetricLine icon="☔" label="강우" value={`${Math.round(norm.rain_days)}일 / 월`} copy={rainCopy(norm.rain_days)} />
          <MetricLine icon="💧" label="습도" value={`${Math.round(norm.humidity)}%`} copy={humidityCopy(norm.humidity)} />
          <MetricLine icon="👥" label="혼잡" value={crowdCopy(selectedMonth, sig?.popularity_score)} copy={null} />
        </div>

        {/* 12개월 mini bar */}
        <div className="px-5 pt-3 pb-4 border-t border-gray-50">
          <p className="text-[11px] text-gray-500 mb-2 font-medium">
            연중 추이 (탭하여 월 변경)
            {seasonalSignals && (
              <span className="text-gray-400 font-normal"> · ⛅날씨 / 한국인 인기</span>
            )}
          </p>
          <div className="flex items-end gap-1 h-16">
            {fitnessScores.map(f => {
              const isSel = f.month === selectedMonth;
              const isRep = f.month === representativeMonth;
              const isDep = (departureDistribution?.[f.month] ?? 0) > 0;
              const climateH = Math.max(8, f.score);
              const sigForMonth = seasonalSignals?.find(s => s.month === f.month);
              const popH = sigForMonth ? Math.max(8, sigForMonth.popularity_score) : null;
              return (
                <button
                  key={f.month}
                  onClick={() => setSelectedMonth(f.month)}
                  className="flex-1 flex flex-col items-center gap-0.5 group"
                  aria-label={`${MONTHS[f.month - 1]} 날씨 ${f.score}점${sigForMonth ? ` · 한국인 인기 ${sigForMonth.popularity_score}점` : ''}`}
                >
                  <div className="w-full flex-1 flex items-end gap-[1px]">
                    <div
                      className={`flex-1 rounded-t-sm transition-all ${scoreColor(f.score)} ${
                        isSel ? 'opacity-100 ring-1 ring-violet-500' : 'opacity-60 group-hover:opacity-90'
                      }`}
                      style={{ height: `${climateH}%` }}
                    />
                    {popH !== null && (
                      <div
                        className={`flex-1 rounded-t-sm transition-all bg-violet-500 ${
                          isSel ? 'opacity-100 ring-1 ring-violet-700' : 'opacity-50 group-hover:opacity-80'
                        }`}
                        style={{ height: `${popH}%` }}
                      />
                    )}
                  </div>
                  <span className={`text-[10px] font-medium ${
                    isSel ? 'text-violet-600' : isRep ? 'text-gray-700' : 'text-gray-400'
                  }`}>
                    {f.month}월
                  </span>
                  {isDep && <span className="w-1 h-1 rounded-full bg-violet-600" />}
                </button>
              );
            })}
          </div>

          {/* 한 줄 자동 요약 */}
          {summary && (
            <div className="mt-3 bg-[#EBF3FE] rounded-lg px-3 py-2.5">
              <p className="text-[12px] text-[#1B64DA] font-semibold leading-snug">
                💡 {summary}
              </p>
            </div>
          )}

          <div className="flex gap-2 mt-2 flex-wrap">
            <Legend color="bg-emerald-500" label="날씨 매우 좋음" />
            <Legend color="bg-amber-400" label="날씨 보통" />
            <Legend color="bg-rose-400" label="날씨 험함" />
            {seasonalSignals && <Legend color="bg-violet-500" label="한국인 인기" />}
          </div>

          <p className="text-[10px] text-gray-400 mt-2">
            ※ 날씨: Open-Meteo 10년 평균 / 한국인 인기도: Naver DataLab + Wikipedia 트래픽 (자동·매월 갱신)
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricLine({ icon, label, value, copy }: { icon: string; label: string; value: string; copy: string | null }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex items-center gap-1.5 w-20 flex-shrink-0 pt-0.5">
        <span className="text-base">{icon}</span>
        <span className="text-[11px] text-gray-400 font-medium">{label}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 tabular-nums leading-snug">{value}</p>
        {copy && <p className="text-[12px] text-gray-500 leading-snug break-keep">{copy}</p>}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-gray-500">
      <span className={`w-2 h-2 rounded-sm ${color}`} />{label}
    </span>
  );
}
