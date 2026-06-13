/**
 * 여행 적합도 카드
 *
 * 예약 직전 고객이 "이 달에 가도 되는지" 빠르게 판단하도록
 * 결론, 리스크, 준비물을 컨시어지 리포트 형태로 보여준다.
 */
'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  TrendingUp,
} from 'lucide-react';
import type { FitnessScore, MonthlyNormal } from '@/lib/travel-fitness-score';
import type { SeasonalSignal } from '@/lib/seasonal-signals';

interface Props {
  destination: string;
  primaryCity: string;
  country: string | null;
  monthlyNormals: MonthlyNormal[];
  fitnessScores?: FitnessScore[] | null;
  /** 한국인 인기도 시그널 (Naver DataLab + Wikipedia). null = 시즌 데이터 없음 */
  seasonalSignals?: SeasonalSignal[] | null;
  /** 이 패키지의 대표 출발월 (1-12). 없으면 현재 월 */
  representativeMonth: number;
  /** 출발월 분포 (월→횟수) — 여러 달이면 보조 월도 표시 */
  departureDistribution?: Record<number, number>;
}

const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

function scoreColor(score: number): string {
  if (score >= 85) return 'bg-emerald-500';
  if (score >= 70) return 'bg-lime-500';
  if (score >= 55) return 'bg-amber-400';
  if (score >= 40) return 'bg-orange-400';
  return 'bg-rose-400';
}

function scoreTone(score: number): {
  label: string;
  headline: string;
  accent: string;
  text: string;
  soft: string;
  border: string;
  bar: string;
  chip: string;
} {
  if (score >= 85) {
    return {
      label: '최적',
      headline: '여행하기 아주 좋은 달',
      accent: '#059669',
      text: 'text-emerald-700',
      soft: 'bg-emerald-50 text-emerald-800',
      border: 'border-emerald-100',
      bar: 'bg-emerald-500',
      chip: 'bg-emerald-600 text-white',
    };
  }
  if (score >= 70) {
    return {
      label: '추천',
      headline: '무난하게 추천할 수 있는 달',
      accent: '#65A30D',
      text: 'text-lime-700',
      soft: 'bg-lime-50 text-lime-800',
      border: 'border-lime-100',
      bar: 'bg-lime-500',
      chip: 'bg-lime-600 text-white',
    };
  }
  if (score >= 55) {
    return {
      label: '준비 권장',
      headline: '준비하면 괜찮은 달',
      accent: '#D97706',
      text: 'text-amber-700',
      soft: 'bg-amber-50 text-amber-900',
      border: 'border-amber-100',
      bar: 'bg-amber-500',
      chip: 'bg-amber-500 text-white',
    };
  }
  if (score >= 40) {
    return {
      label: '주의',
      headline: '일정 여유가 필요한 달',
      accent: '#EA580C',
      text: 'text-orange-700',
      soft: 'bg-orange-50 text-orange-900',
      border: 'border-orange-100',
      bar: 'bg-orange-500',
      chip: 'bg-orange-500 text-white',
    };
  }
  return {
    label: '비추천',
    headline: '날씨 부담이 큰 달',
    accent: '#E11D48',
    text: 'text-rose-700',
    soft: 'bg-rose-50 text-rose-800',
    border: 'border-rose-100',
    bar: 'bg-rose-500',
    chip: 'bg-rose-500 text-white',
  };
}

function cleanConcern(keyConcern: string | null): string | null {
  const text = keyConcern?.replace(/ ?[☔☀️🥶💧]/g, '').trim();
  return text || null;
}

function cleanBadge(badge: string | null | undefined): string | null {
  const text = badge?.replace(/ ?[☔☀️🥶💧🌤️🌧️🌦️❄️🔥]/g, '').trim();
  return text || null;
}

function tempCopy(tempMean: number): string {
  if (tempMean <= 5) return '패딩과 장갑까지 준비';
  if (tempMean <= 12) return '코트와 니트가 안정적';
  if (tempMean <= 17) return '가디건이나 자켓 필요';
  if (tempMean <= 22) return '낮엔 긴팔, 저녁엔 겉옷';
  if (tempMean <= 27) return '낮 반팔, 아침저녁 겉옷';
  if (tempMean <= 32) return '모자와 선크림 중심';
  return '한낮 더위와 실내 일정 병행';
}

function rainCopy(rainDays: number): string {
  const r = Math.round(rainDays);
  if (r <= 2) return '비 걱정이 적음';
  if (r <= 5) return '접이식 우산 정도';
  if (r <= 9) return '우산 준비 권장';
  if (r <= 15) return '우산과 방수 신발 필수';
  return '우기권, 실내 일정 병행';
}

function humidityCopy(humidity: number): string {
  if (humidity <= 40) return '건조한 편';
  if (humidity <= 55) return '한국보다 건조';
  if (humidity <= 70) return '한국과 비슷한 쾌적도';
  if (humidity <= 80) return '약간 습함';
  return '습도 높음';
}

function crowdCopy(month: number, popularity?: number): string {
  if (popularity !== undefined) {
    if (popularity >= 85) return '최성수기';
    if (popularity >= 70) return '인기 시즌';
    if (popularity >= 50) return '수요 안정';
    return '한적한 시기';
  }
  const peak = { 1: 8, 2: 5, 3: 5, 4: 6, 5: 7, 6: 5, 7: 9, 8: 9, 9: 5, 10: 7, 11: 4, 12: 8 }[month] ?? 5;
  if (peak >= 8) return '성수기';
  if (peak >= 6) return '준성수기';
  return '비수기';
}

function climateCaption(score: number, keyConcern: string | null): string {
  const concern = cleanConcern(keyConcern);
  if (score >= 85) return '날씨 걱정이 적어 일정 만족도가 높은 시기입니다.';
  if (score >= 70) return concern ? `${concern}만 확인하면 대체로 쾌적합니다.` : '대체로 쾌적하게 다녀오기 좋은 시기입니다.';
  if (score >= 55) return concern ? `${concern} 대비만 하면 충분히 즐길 수 있습니다.` : '준비물만 맞추면 무난하게 다녀오기 좋은 시기입니다.';
  if (score >= 40) return concern ? `${concern} 영향이 있어 일정과 옷차림을 신경 써야 합니다.` : '날씨 변동을 감안해 일정 여유를 두는 편이 좋습니다.';
  return '날씨 부담이 커서 일정과 준비물을 신중히 확인해야 합니다.';
}

function popularityCaption(score: number): string {
  if (score >= 90) return '한국인이 가장 많이 찾는 시즌';
  if (score >= 75) return '검색과 예약이 활발한 시기';
  if (score >= 60) return '꾸준히 인기 있는 시즌';
  if (score >= 45) return '평균적인 수요';
  if (score >= 30) return '가격 이점 가능';
  return '한적한 시기';
}

function popularityShortCopy(score: number): string {
  if (score >= 85) return '선예약 권장';
  if (score >= 70) return '예약 활발';
  if (score >= 50) return '수요 안정';
  return '비교적 여유';
}

function chartSummary(
  fitnessScores: FitnessScore[],
  signals: SeasonalSignal[] | null,
  representativeMonth: number,
): string {
  const repFit = fitnessScores.find((f) => f.month === representativeMonth);
  const repSig = signals?.find((s) => s.month === representativeMonth);
  if (!repFit) return '';

  const climate = repFit.score;
  const pop = repSig?.popularity_score;
  const peakMonth = signals
    ? signals.reduce((a, b) => (a.popularity_score > b.popularity_score ? a : b)).month
    : fitnessScores.reduce((a, b) => (a.score > b.score ? a : b)).month;

  if (peakMonth === representativeMonth && pop !== undefined && pop >= 75) {
    if (climate >= 70) return `${MONTHS[representativeMonth - 1]}은 인기와 날씨가 같이 좋은 달입니다.`;
    if (climate >= 50) return `${MONTHS[representativeMonth - 1]}은 인기 시즌입니다. 날씨 준비만 하면 만족도가 괜찮습니다.`;
    return `${MONTHS[representativeMonth - 1]}은 인기 시즌이지만 날씨 대비가 필요합니다.`;
  }
  if (pop !== undefined && pop >= 75) {
    return `${MONTHS[representativeMonth - 1]} 출발은 한국인 인기 시즌입니다. 피크는 ${MONTHS[peakMonth - 1]}입니다.`;
  }
  if (pop !== undefined && pop < 45) {
    return `${MONTHS[representativeMonth - 1]} 출발은 한적하고 가격 이점을 기대하기 좋은 시기입니다.`;
  }
  if (climate >= 70) return `${MONTHS[representativeMonth - 1]} 출발은 날씨 적합도가 좋은 편입니다.`;
  return `${MONTHS[representativeMonth - 1]} 출발은 준비물을 맞추면 합리적으로 다녀오기 좋은 타이밍입니다.`;
}

function buildPackingTips(norm: MonthlyNormal): string[] {
  const tips: string[] = [];
  if (Math.round(norm.rain_days) >= 8) tips.push('접이식 우산');
  if (Math.round(norm.rain_days) >= 10) tips.push('방수 신발');
  if (norm.temp_mean <= 27) tips.push('얇은 겉옷');
  if (norm.humidity >= 75) tips.push('잘 마르는 옷');
  if (norm.temp_mean >= 28) tips.push('모자·선크림');
  return Array.from(new Set(tips)).slice(0, 4);
}

export default function TravelFitnessCard({
  destination,
  primaryCity,
  country,
  monthlyNormals,
  fitnessScores,
  seasonalSignals,
  representativeMonth,
  departureDistribution,
}: Props) {
  const [selectedMonth, setSelectedMonth] = useState(representativeMonth);
  const [expanded, setExpanded] = useState(false);
  const safeMonthlyNormals = Array.isArray(monthlyNormals) ? monthlyNormals : [];
  const safeFitnessScores = Array.isArray(fitnessScores) ? fitnessScores : [];
  const safeSeasonalSignals = Array.isArray(seasonalSignals) ? seasonalSignals : null;
  if (!safeFitnessScores.length || !safeMonthlyNormals.length) return null;

  const sel = safeFitnessScores.find((f) => f.month === selectedMonth) || safeFitnessScores[0];
  const norm = safeMonthlyNormals.find((m) => m.month === selectedMonth) || safeMonthlyNormals[0];
  const sig = safeSeasonalSignals?.find((s) => s.month === selectedMonth) ?? null;
  if (!sel || !norm) return null;

  const isRepMonth = selectedMonth === representativeMonth;
  const displayCity = primaryCity || destination;
  const tone = scoreTone(sel.score);
  const summary = chartSummary(safeFitnessScores, safeSeasonalSignals, representativeMonth);
  const packingTips = buildPackingTips(norm);
  const hasDetails = safeFitnessScores.length > 1;
  const badge = cleanBadge(sig?.badge);
  const rainDays = Math.round(norm.rain_days);
  const tempMean = Math.round(norm.temp_mean);
  const scoreWidth = Math.max(6, Math.min(100, sel.score));

  return (
    <section className="px-4 mt-5">
      <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
        <div className="relative px-5 pb-4 pt-4">
          <div
            className="absolute inset-x-0 top-0 h-1"
            style={{ background: `linear-gradient(90deg, #0f172a 0%, ${tone.accent} 54%, #e2e8f0 100%)` }}
          />

          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold tracking-[0.14em] text-slate-400">
                여행 시기 진단
              </p>
              <h3 className="mt-1 text-[19px] font-black leading-tight text-slate-950 break-keep">
                {MONTHS[selectedMonth - 1]} {displayCity} 여행 시기
              </h3>
              <p className="mt-1 text-[14px] font-extrabold text-slate-700 break-keep">{tone.headline}</p>
              {!isRepMonth && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(representativeMonth)}
                  className="mt-2 text-[12px] font-bold text-slate-500 underline underline-offset-2"
                >
                  대표 출발월로 보기
                </button>
              )}
            </div>

            <div className="shrink-0 text-right">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tone.chip}`}>
                {tone.label}
              </span>
              <p className={`mt-2 text-[24px] font-black leading-none tabular-nums ${tone.text}`}>
                {sel.score}
              </p>
              <p className="text-[10px] font-bold text-slate-400">점</p>
            </div>
          </div>

          <p className="mt-3 text-[14px] font-bold leading-relaxed text-slate-800 break-keep">
            {climateCaption(sel.score, sel.key_concern)}
          </p>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
              <span>적합도</span>
              <span>{sel.score}/100</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${scoreWidth}%` }} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/70">
          <SnapshotMetric label="비" value={`${rainDays}일`} detail={rainDays >= 10 ? '방수 준비' : rainCopy(norm.rain_days)} />
          <SnapshotMetric label="기온" value={`${tempMean}°`} detail={`${Math.round(norm.temp_min)}~${Math.round(norm.temp_max)}°`} />
          <SnapshotMetric label="인기" value={sig ? `${sig.popularity_score}점` : crowdCopy(selectedMonth)} detail={sig ? popularityShortCopy(sig.popularity_score) : '휴가 기준'} />
        </div>

        <div className="px-5 py-3.5">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${tone.text}`} strokeWidth={2.3} aria-hidden="true" />
            <p className="text-[13px] font-extrabold leading-relaxed text-slate-900 break-keep">
              {packingTips.length ? packingTips.join(' · ') : '기본 여행 준비물'} 중심으로 챙기면 안정적입니다.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <DecisionPill strong={rainDays >= 10}>{rainDays >= 10 ? '우기 대비 필요' : rainCopy(norm.rain_days)}</DecisionPill>
            <DecisionPill>{tempCopy(norm.temp_mean)}</DecisionPill>
            <DecisionPill>{sig ? popularityShortCopy(sig.popularity_score) : crowdCopy(selectedMonth)}</DecisionPill>
          </div>

          {sig && badge && (
            <p className="mt-3 text-[11px] font-semibold leading-relaxed text-slate-500 break-keep">
              한국인 예약 흐름: {popularityCaption(sig.popularity_score)} · {badge}
            </p>
          )}
        </div>

        {hasDetails && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-between gap-3 bg-slate-50/70 px-5 py-3.5 text-left"
              aria-expanded={expanded}
            >
              <span>
                <span className="block text-[13px] font-extrabold text-slate-900">12개월 비교</span>
                <span className="block text-[11px] font-semibold text-slate-500">날씨와 한국인 인기도 흐름</span>
              </span>
              <ChevronDown
                size={18}
                className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {expanded && (
              <div className="px-5 pb-4 pt-3">
                <div className="flex h-16 items-end gap-1">
                  {safeFitnessScores.map((f) => {
                    const isSel = f.month === selectedMonth;
                    const isRep = f.month === representativeMonth;
                    const isDep = (departureDistribution?.[f.month] ?? 0) > 0;
                    const climateH = Math.max(8, f.score);
                    const sigForMonth = safeSeasonalSignals?.find((s) => s.month === f.month);
                    const popH = sigForMonth ? Math.max(8, sigForMonth.popularity_score) : null;
                    return (
                      <button
                        key={f.month}
                        type="button"
                        onClick={() => setSelectedMonth(f.month)}
                        className="group flex flex-1 flex-col items-center gap-0.5"
                        aria-label={`${MONTHS[f.month - 1]} 날씨 ${f.score}점${sigForMonth ? ` · 한국인 인기 ${sigForMonth.popularity_score}점` : ''}`}
                      >
                        <div className="flex w-full flex-1 items-end gap-[1px]">
                          <div
                            className={`flex-1 rounded-t-sm transition-all ${scoreColor(f.score)} ${
                              isSel ? 'opacity-100 ring-1 ring-slate-900' : 'opacity-55 group-hover:opacity-90'
                            }`}
                            style={{ height: `${climateH}%` }}
                          />
                          {popH !== null && (
                            <div
                              className={`flex-1 rounded-t-sm bg-slate-700 transition-all ${
                                isSel ? 'opacity-100 ring-1 ring-slate-900' : 'opacity-35 group-hover:opacity-70'
                              }`}
                              style={{ height: `${popH}%` }}
                            />
                          )}
                        </div>
                        <span className={`text-[10px] font-semibold ${
                          isSel ? 'text-slate-950' : isRep ? 'text-slate-700' : 'text-slate-400'
                        }`}>
                          {f.month}
                        </span>
                        {isDep && <span className="h-1 w-1 rounded-full bg-slate-900" />}
                      </button>
                    );
                  })}
                </div>

                {summary && (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <TrendingUp size={14} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
                      <p className="text-[12px] font-semibold leading-snug text-slate-700 break-keep">
                        {summary}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                  <Legend color="bg-emerald-500" label="날씨 매우 좋음" />
                  <Legend color="bg-amber-400" label="날씨 보통" />
                  <Legend color="bg-rose-400" label="날씨 험함" />
                  {safeSeasonalSignals && <Legend color="bg-slate-700" label="한국인 인기" />}
                </div>

                <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
                  날씨: Open-Meteo 10년 평균 / 한국인 인기도: Naver DataLab + Wikipedia 트래픽
                  {country ? ` · ${country} 기준 자동 갱신` : ' · 자동 갱신'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SnapshotMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 px-3 py-3 text-center [&+&]:border-l [&+&]:border-slate-100">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-0.5 text-[16px] font-black leading-tight text-slate-950 tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">{detail}</p>
    </div>
  );
}

function DecisionPill({ children, strong = false }: { children: string; strong?: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
      strong ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'
    }`}>
      {children}
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
