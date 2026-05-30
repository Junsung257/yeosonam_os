/**
 * Customer Segmentation — RFM 기반 고객 세분화
 *
 * - bookings 테이블 데이터로 Recency·Frequency·Monetary 점수 산출
 * - quintile(5분위) 분포 기반 1~5점 할당
 * - customer_rfm 테이블에 UPSERT → 일별 배치 재계산 안전
 * - 마케팅 자동화(EngagementAgent 등)에서 세그먼트별 타겟 발송에 사용
 */
import { supabaseAdmin } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────

export interface BookingRow {
  id: string;
  lead_customer_id: string | null;
  booking_date: string;
  total_price: number | null;
  status: string | null;
  is_deleted: boolean | null;
  customer_email?: string | null;
  destination?: string | null;
  product_type?: string | null;
}

export interface CustomerAggregate {
  customerId: string;
  customerEmail: string | null;
  recencyDays: number;
  frequency: number;
  monetaryTotal: number;
  lastBookingAt: string | null;
  firstBookingAt: string | null;
  preferredDestination: string | null;
  preferredProductType: string | null;
}

export interface RFMScore {
  customerId: string;
  customerEmail: string | null;
  recencyDays: number;
  frequency: number;
  monetaryTotal: number;
  rScore: number;
  fScore: number;
  mScore: number;
  rfmCombined: string;
  segmentName: string;
  recommendedAction: string;
}

export interface SegmentStats {
  segmentName: string;
  customerCount: number;
  avgRecency: number;
  avgFrequency: number;
  avgMonetary: number;
  totalRevenue: number;
}

interface SegmentRow {
  id: string;
  segment_name: string;
  r_min: number;
  r_max: number;
  f_min: number;
  f_max: number;
  m_min: number;
  m_max: number;
  recommended_action: string | null;
}

interface CustomerRFMRow {
  id: string;
  customer_id: string;
  customer_email: string | null;
  recency_days: number;
  frequency: number;
  monetary_total: number;
  r_score: number;
  f_score: number;
  m_score: number;
  rfm_combined: string;
  segment_id: string | null;
  last_booking_at: string | null;
  first_booking_at: string | null;
  preferred_destination: string | null;
  preferred_product_type: string | null;
  computed_at: string;
}

// ── Quintile Helpers ───────────────────────────────────────

function assignQuintileScore(value: number, boundaries: number[]): number {
  // boundaries: [p20, p40, p60, p80] — 5구간 경계값
  // 1점(최하) ~ 5점(최상)
  if (value <= boundaries[0]) return 1;
  if (value <= boundaries[1]) return 2;
  if (value <= boundaries[2]) return 3;
  if (value <= boundaries[3]) return 4;
  return 5;
}

function computeQuintiles(sorted: number[]): number[] {
  if (sorted.length < 5) {
    // 데이터가 충분하지 않으면 균등 분할
    const n = sorted.length;
    if (n === 0) return [0, 0, 0, 0];
    return [
      sorted[Math.max(0, Math.floor(n * 0.2) - 1)] ?? sorted[0],
      sorted[Math.max(0, Math.floor(n * 0.4) - 1)] ?? sorted[0],
      sorted[Math.max(0, Math.floor(n * 0.6) - 1)] ?? sorted[0],
      sorted[Math.max(0, Math.floor(n * 0.8) - 1)] ?? sorted[0],
    ];
  }
  return [
    sorted[Math.floor(sorted.length * 0.2)],
    sorted[Math.floor(sorted.length * 0.4)],
    sorted[Math.floor(sorted.length * 0.6)],
    sorted[Math.floor(sorted.length * 0.8)],
  ];
}

// ── Core Logic ─────────────────────────────────────────────

/**
 * bookings 테이블에서 고객별 집계 데이터를 조회한다.
 * 취소·삭제된 예약은 제외한다.
 */
async function fetchCustomerAggregates(): Promise<CustomerAggregate[]> {
  const { data: bookings, error } = await supabaseAdmin
    .from('bookings')
    .select(`
      lead_customer_id,
      booking_date,
      total_price,
      status,
      is_deleted
    `)
    .not('lead_customer_id', 'is', null)
    .or('is_deleted.is.null,is_deleted.eq.false');

  if (error) throw new Error(`bookings 조회 실패: ${error.message}`);
  if (!bookings || (bookings as BookingRow[]).length === 0) return [];

  const raw = bookings as BookingRow[];

  // 고객별 집계
  const customerMap = new Map<string, {
    dates: string[];
    totals: number[];
  }>();

  for (const b of raw) {
    if (!b.lead_customer_id) continue;
    if (b.status === 'cancelled' || b.status === 'voided') continue;

    const key = b.lead_customer_id;
    if (!customerMap.has(key)) {
      customerMap.set(key, { dates: [], totals: [] });
    }
    const entry = customerMap.get(key)!;
    if (b.booking_date) entry.dates.push(b.booking_date);
    if (b.total_price != null) entry.totals.push(Number(b.total_price));
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const customers: CustomerAggregate[] = [];
  for (const [customerId, data] of customerMap.entries()) {
    const sortedDates = data.dates.sort();
    const lastDate = sortedDates[sortedDates.length - 1];
    const firstDate = sortedDates[0];

    const recencyDays = lastDate
      ? Math.floor((today.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    customers.push({
      customerId,
      customerEmail: null, // 이메일은 customers 테이블에서 별도 조회
      recencyDays,
      frequency: data.dates.length,
      monetaryTotal: data.totals.reduce((a, b) => a + b, 0),
      lastBookingAt: lastDate ?? null,
      firstBookingAt: firstDate ?? null,
      preferredDestination: null,
      preferredProductType: null,
    });
  }

  return customers;
}

/**
 * quintile 경계값을 계산하고 각 고객에 1~5점을 할당한다.
 *
 * Recency는 작을수록 좋으므로(최근일수록 높은 점수) 값의 역순으로 quintile을 계산한다.
 */
function scoreCustomers(customers: CustomerAggregate[]): CustomerAggregate[] {
  if (customers.length === 0) return customers;

  // Recency: 작을수록 좋음 → 정렬 후 순서 반전
  const recencySorted = [...customers].map(c => c.recencyDays).sort((a, b) => a - b);
  const recencyBoundaries = computeQuintiles(recencySorted);

  // Frequency: 클수록 좋음
  const freqSorted = [...customers].map(c => c.frequency).sort((a, b) => a - b);
  const freqBoundaries = computeQuintiles(freqSorted);

  // Monetary: 클수록 좋음
  const monetarySorted = [...customers].map(c => c.monetaryTotal).sort((a, b) => a - b);
  const monetaryBoundaries = computeQuintiles(monetarySorted);

  return customers.map(c => {
    // Recency는 낮을수록 좋으므로 점수 반전
    const reversedRecency = recencySorted.map(r => -r).sort((a, b) => a - b);
    const rBoundaries = computeQuintiles(reversedRecency);
    const rValue = -c.recencyDays;

    const rScore = assignQuintileScore(rValue, rBoundaries);
    const fScore = assignQuintileScore(c.frequency, freqBoundaries);
    const mScore = assignQuintileScore(c.monetaryTotal, monetaryBoundaries);

    return { ...c, rScore, fScore, mScore, rfmCombined: `${rScore}-${fScore}-${mScore}` };
  }) as (CustomerAggregate & { rScore: number; fScore: number; mScore: number; rfmCombined: string })[];
}

/**
 * RFM 조합 점수에 맞는 세그먼트를 customer_segments 테이블에서 찾는다.
 * 일치하는 세그먼트가 없으면 가장 가까운 세그먼트로 fallback한다.
 */
async function matchSegment(
  rScore: number,
  fScore: number,
  mScore: number,
): Promise<{ segmentId: string; segmentName: string; recommendedAction: string }> {
  const { data: segments, error } = await supabaseAdmin
    .from('customer_segments')
    .select('id, segment_name, r_min, r_max, f_min, f_max, m_min, m_max, recommended_action');

  if (error || !segments || (segments as SegmentRow[]).length === 0) {
    return { segmentId: '', segmentName: 'new_customers', recommendedAction: '웰컴 시리즈, 두 번째 구독 유도' };
  }

  const rows = segments as SegmentRow[];

  // 1차: R·F·M 각각 범위 내 정확 매칭
  for (const seg of rows) {
    if (
      rScore >= seg.r_min && rScore <= seg.r_max &&
      fScore >= seg.f_min && fScore <= seg.f_max &&
      mScore >= seg.m_min && mScore <= seg.m_max
    ) {
      return {
        segmentId: seg.id,
        segmentName: seg.segment_name,
        recommendedAction: seg.recommended_action ?? '',
      };
    }
  }

  // 2차: 유클리드 거리 기반 최근접 매칭 (중앙값 기준)
  let best = rows[0];
  let bestDist = Infinity;
  for (const seg of rows) {
    const rMid = (seg.r_min + seg.r_max) / 2;
    const fMid = (seg.f_min + seg.f_max) / 2;
    const mMid = (seg.m_min + seg.m_max) / 2;
    const dist = Math.sqrt(
      (rScore - rMid) ** 2 +
      (fScore - fMid) ** 2 +
      (mScore - mMid) ** 2
    );
    if (dist < bestDist) {
      bestDist = dist;
      best = seg;
    }
  }

  return {
    segmentId: best.id,
    segmentName: best.segment_name,
    recommendedAction: best.recommended_action ?? '',
  };
}

// ── Public API ─────────────────────────────────────────────

/**
 * RFM 점수를 계산하고 customer_rfm 테이블에 UPSERT한다.
 *
 * idempotent: 같은 customer_id에 대해 항상 UPSERT로 동작한다.
 * 일별 배치(cron)에서 호출해도 중복 레코드가 생기지 않는다.
 */
export async function computeRFM(): Promise<{ computed: number }> {
  // 1. bookings 집계
  const customers = await fetchCustomerAggregates();
  if (customers.length === 0) return { computed: 0 };

  // 2. 점수 할당
  const scored = scoreCustomers(customers);

  // 3. 이메일 보강 (customers 테이블 조회)
  const customerIds = scored.map(c => c.customerId).filter(Boolean);
  const { data: customerRows } = await supabaseAdmin
    .from('customers')
    .select('id, email')
    .in('id', customerIds);

  const emailMap = new Map<string, string>();
  if (customerRows) {
    for (const row of customerRows as Array<{ id: string; email: string | null }>) {
      if (row.id && row.email) emailMap.set(row.id, row.email);
    }
  }

  // 4. RFM 매칭 → UPSERT
  let computed = 0;
  for (const c of scored) {
    type ScoredCustomer = CustomerAggregate & { rScore: number; fScore: number; mScore: number; rfmCombined: string };
    const s = c as unknown as ScoredCustomer;
    const { segmentId } = await matchSegment(
      s.rScore,
      s.fScore,
      s.mScore,
    );

    const email = emailMap.get(s.customerId) ?? null;

    const { error } = await supabaseAdmin
      .from('customer_rfm')
      .upsert({
        customer_id: s.customerId,
        customer_email: email,
        recency_days: s.recencyDays,
        frequency: s.frequency,
        monetary_total: s.monetaryTotal,
        r_score: s.rScore,
        f_score: s.fScore,
        m_score: s.mScore,
        rfm_combined: s.rfmCombined,
        segment_id: segmentId || null,
        last_booking_at: c.lastBookingAt,
        first_booking_at: c.firstBookingAt,
        computed_at: new Date().toISOString(),
      } as never, {
        onConflict: 'customer_id',
      });

    if (error) {
      console.warn(`[customer-segmentation] UPSERT 실패 (${c.customerId}): ${error.message}`);
      continue;
    }
    computed++;
  }

  return { computed };
}

/**
 * 특정 세그먼트에 속한 고객 목록을 조회한다.
 */
export async function getCustomersBySegment(
  segmentName: string,
  opts?: { limit?: number },
): Promise<RFMScore[]> {
  const limit = opts?.limit ?? 100;

  const { data, error } = await supabaseAdmin
    .from('customer_rfm')
    .select(`
      customer_id,
      customer_email,
      recency_days,
      frequency,
      monetary_total,
      r_score,
      f_score,
      m_score,
      rfm_combined,
      segment_id,
      last_booking_at,
      first_booking_at,
      computed_at
    `)
    .limit(limit);

  if (error) throw new Error(`customer_rfm 조회 실패: ${error.message}`);

  const rows = (data as CustomerRFMRow[] | null) ?? [];

  // segment_id → segment_name 변환
  const { data: segments } = await supabaseAdmin
    .from('customer_segments')
    .select('id, segment_name, recommended_action');

  const segmentMap = new Map<string, { name: string; action: string }>();
  if (segments) {
    for (const s of segments as Array<{ id: string; segment_name: string; recommended_action: string | null }>) {
      segmentMap.set(s.id, { name: s.segment_name, action: s.recommended_action ?? '' });
    }
  }

  // segment_name으로 필터링
  const matchedSegIds = [...segmentMap.entries()]
    .filter(([, v]) => v.name === segmentName)
    .map(([k]) => k);
  const matchedSegAction = [...segmentMap.values()].find(v => v.name === segmentName)?.action ?? '';

  return rows
    .filter(r => matchedSegIds.includes(r.segment_id ?? ''))
    .map(r => ({
      customerId: r.customer_id,
      customerEmail: r.customer_email,
      recencyDays: r.recency_days,
      frequency: r.frequency,
      monetaryTotal: r.monetary_total,
      rScore: r.r_score,
      fScore: r.f_score,
      mScore: r.m_score,
      rfmCombined: r.rfm_combined,
      segmentName,
      recommendedAction: matchedSegAction,
    }));
}

/**
 * 전체 세그먼트 통계를 집계한다.
 */
export async function getSegmentStats(): Promise<SegmentStats[]> {
  const { data: segments } = await supabaseAdmin
    .from('customer_segments')
    .select('id, segment_name');

  if (!segments || (segments as SegmentRow[]).length === 0) return [];

  const segRows = segments as SegmentRow[];

  // customer_rfm을 세그먼트별로 집계
  const stats: SegmentStats[] = [];

  for (const seg of segRows) {
    const { data: rfmRows } = await supabaseAdmin
      .from('customer_rfm')
      .select('recency_days, frequency, monetary_total')
      .eq('segment_id', seg.id);

    const rows = (rfmRows as Array<{ recency_days: number; frequency: number; monetary_total: number }> | null) ?? [];

    if (rows.length === 0) {
      stats.push({
        segmentName: seg.segment_name,
        customerCount: 0,
        avgRecency: 0,
        avgFrequency: 0,
        avgMonetary: 0,
        totalRevenue: 0,
      });
      continue;
    }

    const sumRecency = rows.reduce((a, r) => a + r.recency_days, 0);
    const sumFreq = rows.reduce((a, r) => a + r.frequency, 0);
    const sumMonetary = rows.reduce((a, r) => a + r.monetary_total, 0);

    stats.push({
      segmentName: seg.segment_name,
      customerCount: rows.length,
      avgRecency: Math.round(sumRecency / rows.length),
      avgFrequency: Math.round((sumFreq / rows.length) * 100) / 100,
      avgMonetary: Math.round(sumMonetary / rows.length),
      totalRevenue: sumMonetary,
    });
  }

  return stats;
}

/**
 * 세그먼트별 마케팅 메시지 템플릿을 반환한다.
 */
export function getSegmentMarketingMessage(segmentName: string): {
  subject: string;
  message: string;
  cta: string;
  offer?: string;
} {
  const messages: Record<string, { subject: string; message: string; cta: string; offer?: string }> = {
    champions: {
      subject: 'VIP 고객님을 위한 스페셜 혜택',
      message: '항상 여소남을 이용해주셔서 감사합니다. VIP 회원 전용 얼리버드 혜택을 준비했습니다.',
      cta: 'VIP 혜택 보기',
      offer: '얼리버드 15% 할인',
    },
    loyal: {
      subject: '고객님의 다음 여행, 준비되셨나요?',
      message: '단골 고객님을 위한 특별 추천 여행 상품을 준비했습니다.',
      cta: '여행 상품 보기',
      offer: '로열티 10% 할인',
    },
    potential_loyalists: {
      subject: '두 번째 여행, 특별 할인 받으세요',
      message: '첫 여행은 즐거우셨나요? 두 번째 여행을 준비하는 고객님께 특별 쿠폰을 드립니다.',
      cta: '쿠폰 받기',
      offer: '두 번째 예약 7% 할인',
    },
    new_customers: {
      subject: '여소남에 오신 것을 환영합니다!',
      message: '첫 여행을 계획 중이신가요? 인기 여행 상품을 확인해보세요.',
      cta: '인기 상품 보기',
      offer: '첫 예약 5% 할인',
    },
    at_risk: {
      subject: '오랜만이에요, 기다리고 있었어요',
      message: '최근 여소남을 방문하지 않으셨네요. 기다리는 동안 새로 추가된 여행 상품이 많아졌어요.',
      cta: '새 상품 보기',
      offer: '재방문 10% 할인',
    },
    hibernating: {
      subject: '여행이 그리워질 때, 여소남이 도와드릴게요',
      message: '오랜만에 여행 소식을 전해드립니다. 시즌 한정 특가 상품을 확인해보세요.',
      cta: '시즌 특가 보기',
      offer: '시즌 한정 15% 할인',
    },
    lost: {
      subject: '다시 찾아온 특별한 기회, 여소남',
      message: '오랜만에 인사드립니다. 더 나은 서비스로 돌아온 여소남에서 특별 할인을 준비했습니다.',
      cta: '할인 받기',
      offer: '재가입 20% 할인',
    },
  };

  return messages[segmentName] ?? messages.new_customers;
}

/**
 * 특정 세그먼트를 대상으로 한 캠페인 이메일 목록을 생성한다.
 * 고객별 선호 여행지/상품이 있으면 메시지에 반영한다.
 */
export async function generateSegmentCampaign(
  segmentName: string,
  opts?: { limit?: number },
): Promise<Array<{ email: string; subject: string; body: string }>> {
  const customers = await getCustomersBySegment(segmentName, opts);
  const template = getSegmentMarketingMessage(segmentName);
  const results: Array<{ email: string; subject: string; body: string }> = [];

  for (const c of customers) {
    if (!c.customerEmail || !c.customerEmail.includes('@')) continue;

    // 선호 여행지가 있으면 메시지에 반영
    const personalization = c.customerEmail
      ? `안녕하세요, ${c.customerEmail.split('@')[0]}님!`
      : '안녕하세요!';

    const body = buildCampaignHtml({
      greeting: personalization,
      message: template.message,
      cta: template.cta,
      offer: template.offer,
      rfmScore: c.rfmCombined,
    });

    results.push({
      email: c.customerEmail,
      subject: template.subject,
      body,
    });
  }

  return results;
}

// ── HTML Builder ───────────────────────────────────────────

function buildCampaignHtml(params: {
  greeting: string;
  message: string;
  cta: string;
  offer?: string;
  rfmScore: string;
}): string {
  const { greeting, message, cta, offer, rfmScore } = params;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1a1a1a">${greeting}</h2>
  <p style="color:#444;line-height:1.6">${message}</p>
  ${offer ? `<div style="background:#F3F4F6;border-radius:8px;padding:12px 16px;margin:16px 0;text-align:center">
    <span style="font-size:14px;color:#666">특별 혜택</span>
    <p style="font-size:20px;font-weight:bold;color:#4F46E5;margin:4px 0">${offer}</p>
  </div>` : ''}
  <a href="${siteUrl}/packages"
     style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">
    ${cta}
  </a>
  <p style="color:#999;font-size:11px;margin-top:32px;">
    RFM Score: ${rfmScore} | 본 메일은 고객 세그먼트 기반 자동 발송됩니다.<br>
    수신 거부를 원하시면 답장으로 알려주세요.
  </p>
</body>
</html>`;
}

/**
 * 전체 customer_rfm 데이터를 초기화하고 재계산한다.
 * 스키마 변경 후 전체 재계산이 필요할 때 사용한다.
 */
export async function refreshAllRFM(): Promise<{ deleted: number; computed: number }> {
  const { data: existing } = await supabaseAdmin
    .from('customer_rfm')
    .select('id');

  const existingCount = (existing as Array<{ id: string }> | null)?.length ?? 0;

  if (existingCount > 0) {
    const { error: delErr } = await supabaseAdmin
      .from('customer_rfm')
      .delete()
      .not('id', 'is', null);

    if (delErr) throw new Error(`customer_rfm 삭제 실패: ${delErr.message}`);
  }

  const { computed } = await computeRFM();
  return { deleted: existingCount, computed };
}

/**
 * 세그먼트별 고객 수를 간단히 조회한다 (대시보드 위젯용).
 */
export async function getSegmentCounts(): Promise<Array<{ segmentName: string; count: number; color: string }>> {
  const { data: segments } = await supabaseAdmin
    .from('customer_segments')
    .select('id, segment_name, color');

  if (!segments) return [];

  const segRows = segments as Array<{ id: string; segment_name: string; color: string | null }>;
  const counts: Array<{ segmentName: string; count: number; color: string }> = [];

  for (const seg of segRows) {
    const { count, error } = await supabaseAdmin
      .from('customer_rfm')
      .select('id', { count: 'exact', head: true })
      .eq('segment_id', seg.id);

    if (error) continue;
    counts.push({
      segmentName: seg.segment_name,
      count: count ?? 0,
      color: seg.color ?? '#gray',
    });
  }

  return counts.sort((a, b) => b.count - a.count);
}
