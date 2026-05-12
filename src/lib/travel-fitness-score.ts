/**
 * 여행 적합도 점수 (Travel Fitness Score)
 *
 * Champion Traveler 응용 — 한국인 여행자 선호 반영 가중치.
 * 가중치 (사장님 결정 2026-04-29):
 *   - temp 0.40   : 기온 안락도 (18~28°C 만점)
 *   - rain 0.35   : 강우 패널티 (0일 만점, 15일 0점) — 한국인 비 싫어함 강조
 *   - crowd 0.15  : 한국 성수기 역가중 (성수기는 가격↑·혼잡↑)
 *   - humidity 0.10: 습도 패널티 (50~70% 만점)
 *
 * 입력은 destination_climate.monthly_normals 의 한 달치 row.
 */

export interface MonthlyNormal {
  month: number;          // 1-12
  temp_max: number;       // °C
  temp_min: number;
  temp_mean: number;
  rain_days: number;      // 강우일수 (≥1mm)
  rain_mm: number;        // 월 강수량 합
  humidity: number;       // % (월 평균)
  sunshine_hours?: number;
}

export interface FitnessScore {
  month: number;
  score: number;            // 0-100
  label: string;            // "매우 좋음" | "좋음" | "보통" | "주의" | "피하세요"
  key_concern: string | null; // 가장 큰 패널티 사유 (없으면 null)
  metrics: { temp: number; rain: number; humidity: number; crowd: number };
}

// ─── 축별 점수 함수 (모두 0~100 반환) ─────────────────────────────

/** 기온: 18~28°C 안에 있으면 100, 멀어질수록 선형 감소 */
function tempComfort(temp: number): number {
  if (temp >= 18 && temp <= 28) return 100;
  // 극단치: 0°C 이하 또는 38°C 이상 → 0점
  if (temp < 18) {
    const d = 18 - temp;
    return Math.max(0, 100 - d * 5); // 18°C에서 1도 떨어질수록 5점 감점
  }
  // temp > 28
  const d = temp - 28;
  return Math.max(0, 100 - d * 7); // 더위는 더 가혹하게 (한국인 7월 동남아 회피)
}

/** 강우일수: 0일 100점, 15일 0점 선형. 그 너머는 0 클램프 */
function rainPenalty(rainDays: number): number {
  return Math.max(0, Math.min(100, 100 - (rainDays / 15) * 100));
}

/** 습도: 50~70% 만점, 외곽은 선형 감소 */
function humidityPenalty(humidity: number): number {
  if (humidity >= 50 && humidity <= 70) return 100;
  if (humidity < 50) {
    const d = 50 - humidity;
    return Math.max(0, 100 - d * 2.5); // 건조한 쪽은 살짝 관대
  }
  const d = humidity - 70;
  return Math.max(0, 100 - d * 3);     // 습한 쪽은 더 가혹
}

/**
 * 한국 성수기 역가중. 성수기 = 가격·혼잡 ↑ → 점수 ↓.
 *  - 1월 (설날), 7~8월 (여름휴가), 12월 (연말) → 페널티
 *  - 4-5월, 9-11월 (봄/가을) → 보너스
 */
function crowdInverse(month: number): number {
  // 한국 여행 트래픽 대략값 (월별 인기도 0~10)
  const peakIdx: Record<number, number> = {
    1: 8,  // 설날 ↑
    2: 5,
    3: 5,
    4: 6,  // 봄
    5: 7,  // 가정의달·휴가
    6: 5,
    7: 9,  // 여름휴가
    8: 9,  // 여름휴가 ↑
    9: 5,  // 추석 영향 변동
    10: 7, // 단풍·가을
    11: 4, // 비수기
    12: 8, // 연말
  };
  const idx = peakIdx[month] ?? 5;
  // 0(혼잡 ↑↑↑) → 60점 / 10(혼잡 ↓↓↓) → 100점
  return 60 + (10 - idx) * 4;
}

// ─── 메인 산식 ────────────────────────────────────────────────────

export function computeFitness(m: MonthlyNormal): FitnessScore {
  const t = tempComfort(m.temp_mean);
  const r = rainPenalty(m.rain_days);
  const h = humidityPenalty(m.humidity);
  const c = crowdInverse(m.month);

  const score = Math.round(0.40 * t + 0.35 * r + 0.10 * h + 0.15 * c);

  const label =
    score >= 85 ? '매우 좋음' :
    score >= 70 ? '좋음' :
    score >= 55 ? '보통' :
    score >= 40 ? '주의' : '피하세요';

  // 가장 점수 낮은 축을 key_concern으로
  const axes = [
    { key: '기온', s: t, msg: m.temp_mean > 30 ? '무더위 ☀️' : m.temp_mean < 10 ? '추위 🥶' : null },
    { key: '강우', s: r, msg: m.rain_days >= 12 ? '우기 ☔' : m.rain_days >= 8 ? '비 자주' : null },
    { key: '습도', s: h, msg: m.humidity >= 80 ? '고습도 💧' : null },
    { key: '혼잡', s: c, msg: c <= 70 ? '성수기 (가격↑)' : null },
  ];
  const worst = axes.reduce((a, b) => a.s < b.s ? a : b);
  const key_concern = score < 75 && worst.msg ? worst.msg : null;

  return { month: m.month, score, label, key_concern, metrics: { temp: t, rain: r, humidity: h, crowd: c } };
}

export function computeFitnessSeries(normals: MonthlyNormal[]): FitnessScore[] {
  return normals.map(computeFitness);
}

// ─── 출발일 → 평균월 산출 ─────────────────────────────────────────
// 패키지의 price_dates / price_tiers 에서 실제 출발일들 → 가장 자주 출발하는 월 1~3개 선정
// (단순 mode 가 아니라 분포 기반 — 봄/가을 양쪽 출발 시 양쪽 다 표시할 수 있게)

export function pickRepresentativeMonths(
  departureDates: string[]
): { primary: number; distribution: Record<number, number> } {
  const dist: Record<number, number> = {};
  for (const d of departureDates) {
    const m = new Date(d).getMonth() + 1;
    if (!isNaN(m)) dist[m] = (dist[m] || 0) + 1;
  }
  let primary = new Date().getMonth() + 1; // fallback: 현재 달
  let max = 0;
  for (const [m, c] of Object.entries(dist)) {
    if (c > max) { max = c; primary = Number(m); }
  }
  return { primary, distribution: dist };
}
