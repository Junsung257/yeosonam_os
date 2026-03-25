/**
 * AI 마케팅 관제소 — AdController
 *
 * 역할:
 *  1. 광고 계정 잔액 1시간 단위 동기화 (Mock API → 실제 API 교체 가능)
 *  2. 잔액 < LOW_BALANCE_THRESHOLD 시 긴급 알림 발생
 *  3. ROAS 기준 키워드 자동 ON/OFF (ROAS < TARGET → PAUSED)
 *  4. 순수익 상위 키워드 FLAGGED_UP (입찰가 상향 대상)
 *  5. 롱테일 키워드 발굴 뼈대 (CPC < 100원)
 *
 * 실제 API 연동 준비:
 *   - 네이버: https://api.naver.com/ncc (NCC API)
 *   - 구글: google-ads-api npm 패키지
 *   - 메타: Meta Marketing API (그래프 API)
 *
 * 환경변수:
 *   NAVER_AD_API_KEY, NAVER_AD_SECRET, NAVER_AD_CUSTOMER_ID
 *   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID
 *   META_AD_ACCOUNT_ID, META_ACCESS_TOKEN
 *   AD_ROAS_TARGET_PCT   기본 150 (%)
 *   AD_LONGTAIL_CPC_MAX  기본 100 (원)
 *   ADMIN_ALERT_EMAIL    잔액 부족 알림 수신 이메일
 */

// ── 설정 상수 ────────────────────────────────────────────────

const ROAS_TARGET_PCT = parseInt(process.env.AD_ROAS_TARGET_PCT ?? '150');
const LONGTAIL_CPC_MAX = parseInt(process.env.AD_LONGTAIL_CPC_MAX ?? '100');

// ── 인터페이스 ────────────────────────────────────────────────

export interface AdAccountSnapshot {
  platform: 'naver' | 'google' | 'meta';
  account_name: string;
  current_balance: number;
  daily_budget: number;
  daily_spend_today: number;
  is_active: boolean;
}

export interface KeywordPerf {
  id: string;
  platform: 'naver' | 'google' | 'meta';
  keyword: string;
  total_spend: number;
  total_revenue: number;   // 판매가 합계
  total_cost: number;      // 원가 합계
  net_profit: number;      // 판매가 - 원가 - 지출액
  roas_pct: number;        // ROAS %
  status: 'ACTIVE' | 'PAUSED' | 'FLAGGED_UP';
  current_bid: number;
  clicks: number;
  conversions: number;
}

export type OptimizationAction =
  | { type: 'PAUSE';    keyword: string; reason: string; roas_pct: number }
  | { type: 'FLAG_UP';  keyword: string; reason: string; net_profit: number }
  | { type: 'NO_CHANGE'; keyword: string; roas_pct: number };

// ═══════════════════════════════════════════════════════════════
// 1. 광고 계정 잔액 동기화
// ═══════════════════════════════════════════════════════════════

/**
 * 플랫폼별 잔액을 Mock API로 조회 (실제 API 교체 포인트).
 * 1시간 단위 cron에서 호출.
 */
export async function syncAdAccountBalance(
  platform: 'naver' | 'google' | 'meta',
  accountName: string
): Promise<AdAccountSnapshot> {
  // ── Mock: 실제 API 미연동 시 더미 데이터 반환 ──────────────
  const mockBalances: Record<string, number> = {
    naver: 120000 + Math.floor(Math.random() * 30000),
    google: 85000  + Math.floor(Math.random() * 20000),
    meta:   43000  + Math.floor(Math.random() * 15000),  // 임박 케이스 시뮬레이션
  };
  const mockDailyBudgets: Record<string, number> = {
    naver: 300000, google: 200000, meta: 150000,
  };

  // TODO: 실제 네이버 API 연동
  // if (platform === 'naver' && process.env.NAVER_AD_API_KEY) {
  //   const res = await fetch('https://api.naver.com/ncc/accounts', {
  //     headers: { 'X-API-KEY': process.env.NAVER_AD_API_KEY!, 'X-SECRET-KEY': process.env.NAVER_AD_SECRET! },
  //   });
  //   const data = await res.json();
  //   return { platform, account_name: accountName, current_balance: data.balance, ... };
  // }

  // TODO: 실제 구글 Ads API 연동
  // if (platform === 'google' && process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
  //   const { GoogleAdsClient } = await import('google-ads-api');
  //   const client = new GoogleAdsClient({ developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN! });
  //   const customer = client.Customer({ customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID! });
  //   const [campaign] = await customer.report({ entity: 'campaign', attributes: ['campaign.status'], metrics: ['metrics.cost_micros'] });
  //   return { platform, current_balance: Number(campaign.metrics.cost_micros) / 1_000_000, ... };
  // }

  // TODO: 실제 Meta Marketing API 연동
  // if (platform === 'meta' && process.env.META_ACCESS_TOKEN) {
  //   const res = await fetch(
  //     `https://graph.facebook.com/v18.0/act_${process.env.META_AD_ACCOUNT_ID}?fields=balance&access_token=${process.env.META_ACCESS_TOKEN}`
  //   );
  //   const data = await res.json();
  //   return { platform, current_balance: parseInt(data.balance), ... };
  // }

  const balance = mockBalances[platform] ?? 100000;
  const dailyBudget = mockDailyBudgets[platform] ?? 100000;

  return {
    platform,
    account_name: accountName,
    current_balance: balance,
    daily_budget: dailyBudget,
    daily_spend_today: Math.floor(dailyBudget * 0.6),
    is_active: true,
  };
}

// ── 잔액 부족 긴급 알림 ──────────────────────────────────────

export async function checkAndAlertLowBalance(
  snapshot: AdAccountSnapshot,
  threshold: number
): Promise<{ alerted: boolean; message: string }> {
  if (snapshot.current_balance > threshold) {
    return { alerted: false, message: '잔액 정상' };
  }

  const message = [
    `[긴급] ${snapshot.platform.toUpperCase()} 광고 잔액 부족`,
    `계정: ${snapshot.account_name}`,
    `현재 잔액: ₩${snapshot.current_balance.toLocaleString('ko-KR')}`,
    `기준 임계값: ₩${threshold.toLocaleString('ko-KR')}`,
    `일일 예산: ₩${snapshot.daily_budget.toLocaleString('ko-KR')}`,
    `→ 즉시 충전이 필요합니다!`,
  ].join('\n');

  console.error('[AdController] 잔액 긴급 알림:\n' + message);

  // TODO: 이메일 발송
  // if (process.env.ADMIN_ALERT_EMAIL) {
  //   await sendEmail({
  //     to: process.env.ADMIN_ALERT_EMAIL,
  //     subject: `[여소남] ${snapshot.platform} 광고 잔액 부족 경고`,
  //     text: message,
  //   });
  // }

  // TODO: 슬랙 Webhook 발송
  // if (process.env.SLACK_WEBHOOK_URL) {
  //   await fetch(process.env.SLACK_WEBHOOK_URL, {
  //     method: 'POST',
  //     body: JSON.stringify({ text: message }),
  //   });
  // }

  return { alerted: true, message };
}

// ═══════════════════════════════════════════════════════════════
// 2. 자동 입찰 최적화 — ROAS 기준 키워드 ON/OFF
// ═══════════════════════════════════════════════════════════════

/**
 * 키워드 성과 데이터를 분석하여 최적화 액션을 결정한다.
 *
 * 분류 기준:
 *   - ROAS < TARGET_PCT        → PAUSED (광고 OFF)
 *   - net_profit 상위 20%      → FLAGGED_UP (입찰가 상향 대상)
 *   - 나머지                   → NO_CHANGE
 *
 * 단, 클릭 수 < 10 (데이터 부족) 키워드는 PAUSED 제외 — 성급한 중단 방지.
 */
export function analyzeKeywords(keywords: KeywordPerf[]): OptimizationAction[] {
  if (keywords.length === 0) return [];

  // 데이터 충분한 키워드만 최적화 (클릭 < 10은 제외)
  const qualified = keywords.filter((k) => k.clicks >= 10);
  const insufficient = keywords.filter((k) => k.clicks < 10);

  // 순수익 상위 20% 기준값 계산
  const sortedByProfit = [...qualified].sort((a, b) => b.net_profit - a.net_profit);
  const top20PercentIdx = Math.ceil(sortedByProfit.length * 0.2);
  const profitThreshold = sortedByProfit[top20PercentIdx - 1]?.net_profit ?? Infinity;

  const actions: OptimizationAction[] = [];

  for (const kw of qualified) {
    if (kw.net_profit >= profitThreshold && profitThreshold > 0) {
      // 순수익 상위 20% → 입찰가 상향 대상
      actions.push({
        type: 'FLAG_UP',
        keyword: kw.keyword,
        reason: `순수익 상위 20% (₩${kw.net_profit.toLocaleString('ko-KR')} / ROAS ${kw.roas_pct}%)`,
        net_profit: kw.net_profit,
      });
    } else if (kw.roas_pct < ROAS_TARGET_PCT) {
      // ROAS 미달 → 광고 일시 중지
      actions.push({
        type: 'PAUSE',
        keyword: kw.keyword,
        reason: `ROAS ${kw.roas_pct}% < 목표 ${ROAS_TARGET_PCT}%`,
        roas_pct: kw.roas_pct,
      });
    } else {
      actions.push({ type: 'NO_CHANGE', keyword: kw.keyword, roas_pct: kw.roas_pct });
    }
  }

  // 데이터 부족 키워드는 NO_CHANGE
  for (const kw of insufficient) {
    actions.push({ type: 'NO_CHANGE', keyword: kw.keyword, roas_pct: kw.roas_pct });
  }

  return actions;
}

/**
 * 최적화 액션을 요약 리포트로 변환 (로그/대시보드용).
 */
export function summarizeOptimization(actions: OptimizationAction[]): {
  paused: number;
  flaggedUp: number;
  noChange: number;
  pausedKeywords: string[];
  flaggedKeywords: string[];
} {
  const paused    = actions.filter((a) => a.type === 'PAUSE');
  const flaggedUp = actions.filter((a) => a.type === 'FLAG_UP');
  const noChange  = actions.filter((a) => a.type === 'NO_CHANGE');
  return {
    paused:          paused.length,
    flaggedUp:       flaggedUp.length,
    noChange:        noChange.length,
    pausedKeywords:  paused.map((a) => a.keyword),
    flaggedKeywords: flaggedUp.map((a) => a.keyword),
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. 롱테일 키워드 발굴 (Keyword Discovery)
// ═══════════════════════════════════════════════════════════════

/**
 * CPC < LONGTAIL_CPC_MAX(기본 100원) 인 키워드를 자동 발굴하여 등록.
 *
 * TODO: 실제 구현 방향
 *   1. 네이버 키워드 도구 API (https://api.naver.com/keywordstool)
 *      - relKeyword 파라미터로 관련 키워드 조회
 *      - monthlyPcQcCnt(검색량) + compIdx(경쟁도) 기반 필터링
 *      - CPC 추정: (compIdx × 기준단가) 또는 실제 입찰 시뮬레이션
 *
 *   2. 구글 Keyword Planner API
 *      - GenerateKeywordIdeas RPC
 *      - average_cpc_micros / 1_000_000 으로 원화 환산
 *
 *   3. 발굴 후 처리:
 *      - keyword_performances 테이블에 is_longtail=true 로 INSERT
 *      - 자동 입찰 등록: 네이버 NCC API createAdKeyword / 구글 MutateAdGroupCriterions
 *      - 7일간 성과 모니터링 후 ROAS 기준으로 유지/제거 결정
 */
export async function discoverLongtailKeywords(params: {
  platform: 'naver' | 'google';
  seedKeywords: string[];
  maxCpc?: number;
}): Promise<{ keyword: string; estimated_cpc: number; monthly_search: number }[]> {
  const maxCpc = params.maxCpc ?? LONGTAIL_CPC_MAX;

  console.log(
    `[KeywordDiscovery] ${params.platform} 롱테일 발굴 시작 — ` +
    `시드: ${params.seedKeywords.join(', ')} / 최대CPC: ₩${maxCpc}`
  );

  // TODO: 네이버 키워드 도구 API 연동
  // if (params.platform === 'naver' && process.env.NAVER_AD_API_KEY) {
  //   const res = await fetch('https://api.naver.com/keywordstool', {
  //     method: 'POST',
  //     headers: { 'X-API-KEY': process.env.NAVER_AD_API_KEY!, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ hintKeywords: params.seedKeywords, showDetail: 1 }),
  //   });
  //   const { keywordList } = await res.json();
  //   return keywordList
  //     .filter((k: any) => k.monthlyPcQcCnt > 100 && k.pcQualityIndex * 100 < maxCpc)
  //     .map((k: any) => ({ keyword: k.relKeyword, estimated_cpc: k.pcQualityIndex * 100, monthly_search: k.monthlyPcQcCnt }));
  // }

  // Mock: 시드 키워드 기반 롱테일 샘플 생성
  const mockResults = params.seedKeywords.flatMap((seed) => [
    { keyword: `${seed} 저렴한`, estimated_cpc: 45, monthly_search: 320 },
    { keyword: `${seed} 추천`, estimated_cpc: 72, monthly_search: 890 },
    { keyword: `${seed} 패키지`, estimated_cpc: 88, monthly_search: 1200 },
  ]);

  return mockResults.filter((r) => r.estimated_cpc < maxCpc);
}

// ── ROAS 계산 유틸 ────────────────────────────────────────────

export function calcRoas(revenue: number, spend: number): number {
  if (spend === 0) return 0;
  return Math.round((revenue / spend) * 100);
}

export function classifyKeywordStatus(
  roas_pct: number,
  net_profit: number,
  clicks: number
): '수익발생' | '돈만씀' | '데이터부족' {
  if (clicks < 10) return '데이터부족';
  if (net_profit > 0 && roas_pct >= ROAS_TARGET_PCT) return '수익발생';
  return '돈만씀';
}
