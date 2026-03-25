/**
 * ══════════════════════════════════════════════════════════
 * Ad-Brain: 자가학습 마케팅 엔진
 * ══════════════════════════════════════════════════════════
 *
 * - Creative ID 발급 (YSN-XXX-XXXX)
 * - CSV 성과 데이터 파싱 + localStorage 캐시
 * - Winner 분석 (CTR >= 3% 또는 전환 상위)
 * - RAG 컨텍스트 인젝션 (프롬프트 상단에 과거 성과 주입)
 */

// ── 타입 ─────────────────────────────────────────────────
export interface AdPerformanceRow {
  creative_id: string;
  campaign_name: string;
  destination: string;
  concept: string;
  target_audience: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  spend: number;
  cpc: number;
  isWinner: boolean;
  importedAt: string;
}

const STORAGE_KEY = 'yeosonam_ad_brain_data';

// ── Creative ID 발급 ─────────────────────────────────────
export function generateCreativeId(productName: string): string {
  // 상품명에서 핵심 키워드 추출 (한글 2~4자)
  const cleaned = productName
    .replace(/\[.*?\]/g, '')
    .replace(/[^\uAC00-\uD7A3a-zA-Z0-9]/g, '')
    .trim();

  const abbr = cleaned.slice(0, 4).toUpperCase() || 'GEN';

  // 랜덤 4자리 영숫자
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars[Math.floor(Math.random() * chars.length)];
  }

  return `YSN-${abbr}-${rand}`;
}

// ── CSV 파싱 결과 저장/조회 ──────────────────────────────
export function savePerformanceData(rows: AdPerformanceRow[]): void {
  try {
    const existing = getPerformanceData();
    // creative_id 기준 중복 제거 (최신 데이터 우선)
    const map = new Map<string, AdPerformanceRow>();
    for (const row of existing) map.set(row.creative_id, row);
    for (const row of rows) map.set(row.creative_id, row);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...map.values()]));
  } catch { /* localStorage 사용 불가 시 무시 */ }
}

export function getPerformanceData(): AdPerformanceRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearPerformanceData(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}

// ── CSV 행 파싱 (Meta Ads 리포트 호환) ──────────────────
export function parseCsvRow(row: Record<string, string>): AdPerformanceRow | null {
  // Meta CSV 컬럼명 매핑 (한글/영문 모두 지원)
  const campaignName = row['Campaign name'] || row['캠페인 이름'] || row['campaign_name'] || row['Campaign Name'] || '';
  const impressions = parseNum(row['Impressions'] || row['노출'] || row['impressions'] || '0');
  const clicks = parseNum(row['Link clicks'] || row['Clicks (all)'] || row['클릭'] || row['clicks'] || '0');
  const conversions = parseNum(row['Results'] || row['Conversions'] || row['전환'] || row['conversions'] || '0');
  const spend = parseNum(row['Amount spent (KRW)'] || row['Amount spent'] || row['지출 금액'] || row['spend'] || '0');

  // creative_id 추출 (YSN-XXX-XXXX 패턴)
  const idMatch = campaignName.match(/YSN-[A-Z0-9가-힣]{1,8}-[A-Z0-9]{4}/);
  if (!idMatch) return null; // 추적 ID 없으면 스킵

  const creative_id = idMatch[0];
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;

  // 목적지/컨셉 추출 시도 (캠페인 이름에서)
  const destination = extractDestination(campaignName);
  const concept = extractConcept(campaignName);
  const target = extractTarget(campaignName);

  return {
    creative_id,
    campaign_name: campaignName,
    destination,
    concept,
    target_audience: target,
    impressions,
    clicks,
    ctr: Math.round(ctr * 100) / 100,
    conversions,
    spend,
    cpc: Math.round(cpc),
    isWinner: ctr >= 3 || conversions >= 5,
    importedAt: new Date().toISOString(),
  };
}

// ── Winner 인사이트 조회 ─────────────────────────────────
export function getWinnerInsights(destination: string): {
  hasData: boolean;
  topWinners: AdPerformanceRow[];
  summary: string;
} {
  const all = getPerformanceData();
  const destLower = destination.toLowerCase();

  // 해당 목적지 데이터 필터
  const destData = all.filter(r =>
    r.destination.toLowerCase().includes(destLower) ||
    r.campaign_name.toLowerCase().includes(destLower)
  );

  if (destData.length === 0) {
    return { hasData: false, topWinners: [], summary: '' };
  }

  // CTR 기준 상위 3개
  const topWinners = [...destData]
    .sort((a, b) => b.ctr - a.ctr)
    .slice(0, 3);

  // 요약 텍스트 생성
  const summaryLines = topWinners.map((w, i) =>
    `${i + 1}위: [${w.target_audience || '전체'}] 타겟, [${w.concept || '일반'}] 소구 → CTR ${w.ctr}%, 전환 ${w.conversions}건, CPC ₩${w.cpc.toLocaleString()}`
  );

  const summary = `[${destination}] 과거 광고 성과 TOP 3:\n${summaryLines.join('\n')}`;

  return { hasData: true, topWinners, summary };
}

// ── RAG 컨텍스트 인젝션 ──────────────────────────────────
export function injectRagContext(prompt: string, destination: string): string {
  const { hasData, summary, topWinners } = getWinnerInsights(destination);

  if (!hasData) return prompt;

  const bestCtr = topWinners[0];
  const ragBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## [System Note] Ad-Brain 과거 성과 데이터 (자동 주입)

${summary}

**핵심 지시:** 과거 데이터 분석 결과, ${destination} 상품은 [${bestCtr?.target_audience || '전체'}] 타겟에게 [${bestCtr?.concept || '일반'}]을 강조했을 때 평균 CTR ${bestCtr?.ctr}%로 1위였다.
이번 기획안의 메인 앵글은 무조건 이것을 기준점으로 파생시켜라.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

  return ragBlock + prompt;
}

// ── 유틸 ─────────────────────────────────────────────────
function parseNum(s: string): number {
  return parseFloat(s.replace(/[,$₩원\s]/g, '')) || 0;
}

function extractDestination(name: string): string {
  const destinations = ['다낭', '방콕', '오사카', '세부', '발리', '푸꾸옥', '장가계', '나트랑', '하노이', '호치민',
    '치앙마이', '괌', '사이판', '하와이', '마카오', '홍콩', '도쿄', '후쿠오카', '삿포로', '연길', '백두산', '청도', '라오스'];
  for (const d of destinations) {
    if (name.includes(d)) return d;
  }
  return '기타';
}

function extractConcept(name: string): string {
  if (name.includes('가성비') || name.includes('실속')) return '가성비';
  if (name.includes('효도') || name.includes('부모')) return '효도여행';
  if (name.includes('럭셔리') || name.includes('프리미엄') || name.includes('5성')) return '럭셔리';
  if (name.includes('호캉스') || name.includes('호텔')) return '호캉스';
  if (name.includes('골프')) return '골프';
  return '일반';
}

function extractTarget(name: string): string {
  if (name.includes('2030') || name.includes('직장인')) return '2030 직장인';
  if (name.includes('3040') || name.includes('가족')) return '3040 가족';
  if (name.includes('5060') || name.includes('시니어')) return '5060 시니어';
  if (name.includes('커플') || name.includes('신혼')) return '커플/신혼';
  return '전체';
}
