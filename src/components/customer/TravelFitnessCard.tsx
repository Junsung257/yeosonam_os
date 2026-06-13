/**
 * 여행 적합도 카드
 *
 * 예약 직전 고객이 "이 달에 가도 되는지" 빠르게 판단하도록
 * 기본 화면은 결론과 3개 핵심 체크만 보여주고, 월별 추이는 접힘 상세로 둔다.
 */
'use client';

import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Info,
  Users,
  type LucideIcon,
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
  text: string;
  bg: string;
  border: string;
  chip: string;
  soft: string;
} {
  if (score >= 85) {
    return {
      label: '매우 좋음',
      text: 'text-emerald-700',
      bg: 'bg-emerald-50',
      border: 'border-emerald-100',
      chip: 'bg-emerald-600 text-white',
      soft: 'bg-emerald-50 text-emerald-700',
    };
  }
  if (score >= 70) {
    return {
      label: '좋음',
      text: 'text-lime-700',
      bg: 'bg-lime-50',
      border: 'border-lime-100',
      chip: 'bg-lime-600 text-white',
      soft: 'bg-lime-50 text-lime-700',
    };
  }
  if (score >= 55) {
    return {
      label: '보통',
      text: 'text-amber-700',
      bg: 'bg-amber-50',
      border: 'border-amber-100',
      chip: 'bg-amber-500 text-white',
      soft: 'bg-amber-50 text-amber-800',
    };
  }
  if (score >= 40) {
    return {
      label: '주의',
      text: 'text-orange-700',
      bg: 'bg-orange-50',
      border: 'border-orange-100',
      chip: 'bg-orange-500 text-white',
      soft: 'bg-orange-50 text-orange-800',
    };
  }
  return {
    label: '비추천',
    text: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-100',
    chip: 'bg-rose-500 text-white',
    soft: 'bg-rose-50 text-rose-700',
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
  if (tempMean <= 5) return '패딩·장갑까지 챙기는 겨울 옷차림';
  if (tempMean <= 12) return '두꺼운 코트와 니트가 안정적';
  if (tempMean <= 17) return '가디건이나 자켓이 필요한 봄가을 날씨';
  if (tempMean <= 22) return '낮엔 긴팔, 저녁엔 가디건';
  if (tempMean <= 27) return '낮 반팔, 아침저녁 얇은 겉옷';
  if (tempMean <= 32) return '반팔·모자·선크림 중심';
  return '한낮 더위 주의, 실내 일정 병행';
}

function rainCopy(rainDays: number): string {
  const r = Math.round(rainDays);
  if (r <= 2) return '비 걱정이 거의 적은 달';
  if (r <= 5) return '접이식 우산 정도면 충분';
  if (r <= 9) return '우산을 챙기면 안정적';
  if (r <= 15) return '우산·방수 신발 필수';
  return '우기권, 실내 일정도 같이 잡기';
}

function humidityCopy(humidity: number): string {
  if (humidity <= 40) return '건조, 보습 제품 챙기기';
  if (humidity <= 55) return '한국보다 건조한 편';
  if (humidity <= 70) return '한국과 비슷한 쾌적도';
  if (humidity <= 80) return '약간 습함, 통풍 좋은 옷';
  return '습도 높음, 얇고 잘 마르는 옷 추천';
}

function crowdCopy(month: number, popularity?: number): string {
  if (popularity !== undefined) {
    if (popularity >= 85) return '최성수기, 인기 코스 선예약';
    if (popularity >= 70) return '인기 시즌, 예약 추천';
    if (popularity >= 50) return '수요 안정적, 비교적 여유';
    return '한적한 시기, 가격 이점';
  }
  const peak = { 1: 8, 2: 5, 3: 5, 4: 6, 5: 7, 6: 5, 7: 9, 8: 9, 9: 5, 10: 7, 11: 4, 12: 8 }[month] ?? 5;
  if (peak >= 8) return '한국 성수기, 혼잡 대비';
  if (peak >= 6) return '준성수기, 적당한 인기';
  return '비수기, 한적한 편';
}

function climateCaption(score: number, keyConcern: string | null): string {
  const concern = cleanConcern(keyConcern);
  if (score >= 85) return '날씨 걱정이 적은 최적 시즌이에요.';
  if (score >= 70) return concern ? `${concern}만 확인하면 대체로 쾌적해요.` : '대체로 쾌적하게 다녀오기 좋아요.';
  if (score >= 55) return concern ? `${concern} 대비만 하면 충분히 즐길 수 있어요.` : '준비물만 맞추면 무난하게 다녀오기 좋아요.';
  if (score >= 40) return concern ? `${concern} 영향이 있어 일정과 옷차림을 신경 써야 해요.` : '날씨 변동을 감안해 일정 여유를 두는 게 좋아요.';
  return '날씨 부담이 큰 달이라 일정과 준비물을 신중히 봐야 해요.';
}

function popularityCaption(score: number): string {
  if (score >= 90) return '한국인이 가장 많이 찾는 시즌';
  if (score >= 75) return '한국인 검색·예약이 활발한 시기';
  if (score >= 60) return '꾸준히 인기 있는 시즌';
  if (score >= 45) return '평균적인 수요';
  if (score >= 30) return '비수기, 가격 이점 가능';
  return '가장 한적한 시기';
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
    if (climate >= 70) return `${MONTHS[representativeMonth - 1]}은 인기와 날씨가 같이 좋은 달이에요.`;
    if (climate >= 50) return `${MONTHS[representativeMonth - 1]}은 인기 시즌이에요. 날씨 준비만 하면 만족도가 괜찮습니다.`;
    return `${MONTHS[representativeMonth - 1]}은 인기 시즌이지만 날씨 대비가 꼭 필요합니다.`;
  }
  if (pop !== undefined && pop >= 75) {
    return `${MONTHS[representativeMonth - 1]} 출발은 한국인 인기 시즌이에요. 피크는 ${MONTHS[peakMonth - 1]}입니다.`;
  }
  if (pop !== undefined && pop < 45) {
    return `${MONTHS[representativeMonth - 1]} 출발은 한적하고 가격 이점을 기대하기 좋은 시기예요.`;
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

  return (
    <section className="px-4 mt-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className={`${tone.bg} ${tone.border} border-b px-4 pb-3 pt-3.5`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 text-slate-800 shadow-sm">
                <Calendar size={19} strokeWidth={2.2} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                  Travel timing
                </p>
                <h3 className="mt-0.5 text-[17px] font-extrabold leading-snug text-slate-950 break-keep">
                  {MONTHS[selectedMonth - 1]} {displayCity} 여행 적합도
                </h3>
                {!isRepMonth && (
                  <button
                    type="button"
                    onClick={() => setSelectedMonth(representativeMonth)}
                    className="mt-1 text-[11px] font-bold text-slate-600 underline underline-offset-2"
                  >
                    출발월로 돌아가기
                  </button>
                )}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tone.chip}`}>
                {tone.label}
              </span>
              <p className={`mt-1 text-[24px] font-black leading-none tabular-nums ${tone.text}`}>{sel.score}</p>
              <p className="text-[10px] font-semibold text-slate-500">/ 100</p>
            </div>
          </div>

          <p className="mt-3 text-[15px] font-extrabold leading-snug text-slate-950 break-keep">
            {climateCaption(sel.score, sel.key_concern)}
          </p>
          {sig && (
            <p className="mt-1 text-[12px] font-semibold leading-relaxed text-slate-600 break-keep">
              한국인 인기도는 <span className="font-extrabold text-slate-900">{popularityCaption(sig.popularity_score)}</span>
              {badge ? ` · ${badge}` : ''}
            </p>
          )}
        </div>

        <div className="px-4 py-3.5">
          <div className="grid gap-2">
              <DecisionItem
              icon={AlertTriangle}
              label="강우"
              value={`${Math.round(norm.rain_days)}일 / 월`}
              copy={rainCopy(norm.rain_days)}
              strong={Math.round(norm.rain_days) >= 10}
            />
              <DecisionItem
              icon={Activity}
              label="기온"
              value={`${Math.round(norm.temp_mean)}° (${Math.round(norm.temp_min)}~${Math.round(norm.temp_max)}°)`}
              copy={tempCopy(norm.temp_mean)}
            />
            <DecisionItem
              icon={Users}
              label="혼잡"
              value={crowdCopy(selectedMonth, sig?.popularity_score)}
              copy={sig ? `${sig.popularity_score}점 · ${sig.label}` : '한국 휴가 시즌 기준'}
            />
          </div>

          {packingTips.length > 0 && (
            <div className={`mt-3 rounded-2xl border ${tone.border} ${tone.soft} px-3.5 py-2.5`}>
              <div className="flex items-start gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" strokeWidth={2.3} aria-hidden="true" />
                <div>
                  <p className="text-[12px] font-extrabold">챙기면 좋아요</p>
                  <p className="mt-0.5 text-[12px] font-semibold leading-relaxed break-keep">
                    {packingTips.join(' · ')}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-2.5 rounded-2xl bg-slate-50 px-3.5 py-2.5">
            <div className="flex items-start gap-2.5">
              <Info size={15} className="mt-0.5 shrink-0 text-slate-500" strokeWidth={2.2} aria-hidden="true" />
              <p className="text-[12px] font-semibold leading-relaxed text-slate-600 break-keep">
                습도 {Math.round(norm.humidity)}% · {humidityCopy(norm.humidity)}
              </p>
            </div>
          </div>
        </div>

        {hasDetails && (
          <div className="border-t border-slate-100">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={expanded}
            >
              <span className="text-[13px] font-extrabold text-slate-800">월별 날씨·인기 비교</span>
              <ChevronDown
                size={18}
                className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {expanded && (
              <div className="px-4 pb-4">
                <p className="mb-2 text-[11px] font-medium text-slate-500">
                  탭하여 다른 월을 미리 볼 수 있어요
                  {safeSeasonalSignals && <span className="font-normal text-slate-400"> · 날씨 / 한국인 인기</span>}
                </p>

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
                    <p className="text-[12px] font-semibold leading-snug text-slate-700 break-keep">
                      {summary}
                    </p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
                  <Legend color="bg-emerald-500" label="날씨 매우 좋음" />
                  <Legend color="bg-amber-400" label="날씨 보통" />
                  <Legend color="bg-rose-400" label="날씨 험함" />
                  {safeSeasonalSignals && <Legend color="bg-slate-700" label="한국인 인기" />}
                </div>

                <div className="mt-3 flex items-start gap-1.5 text-[10px] leading-relaxed text-slate-400">
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p>
                    날씨: Open-Meteo 10년 평균 / 한국인 인기도: Naver DataLab + Wikipedia 트래픽
                    {country ? ` · ${country} 기준 자동 갱신` : ' · 자동 갱신'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionItem({
  icon: Icon,
  label,
  value,
  copy,
  strong = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  copy: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
        strong ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'
      }`}>
        <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-bold text-slate-400">{label}</p>
          {strong && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">주의</span>}
        </div>
        <p className="text-[14px] font-extrabold leading-snug text-slate-950 break-keep">{value}</p>
        <p className="mt-0.5 text-[11px] font-semibold leading-snug text-slate-500 break-keep">{copy}</p>
      </div>
    </div>
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
