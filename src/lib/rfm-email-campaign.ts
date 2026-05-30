/**
 * RFM 기반 세그먼트 이메일 캠페인
 *
 * customer_rfm + customer_segments 의 세그먼트 결과를 Resend 이메일 API와 연결한다.
 * RESEND_API_KEY 미설정 시 모든 발송이 skip 된다.
 *
 * 의존성:
 *   - supabaseAdmin (@/lib/supabase) — customer_rfm, customer_segments, segment_campaign_logs
 *   - Resend (resend 패키지, va-email.ts 패턴)
 *   - getSecret (@/lib/secret-registry)
 */
import { Resend } from 'resend';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

// ── 타입 ──────────────────────────────────────────────────────

export interface CampaignMessage {
  subject: string;
  body: string;
  cta: string;
}

export interface CampaignResult {
  segment: string;
  sent: number;
  failed: number;
}

export interface SendSegmentResult {
  sent: number;
  failed: number;
  errors: string[];
}

// ── 7개 세그먼트 캠페인 메시지 ───────────────────────────────

const SEGMENT_MESSAGES: Record<string, CampaignMessage> = {
  champions: {
    subject: 'VIP 회원님을 위한 스페셜 혜택',
    body: '여소남을 가장 사랑해주시는 VIP 회원님께만 드리는 특별한 혜택을 준비했습니다. 신규 상품을 가장 먼저 만나보실 수 있는 얼리버드 할인과 독점 프로모션을 지금 확인하세요. 여소남이 엄선한 프리미엄 패키지로 잊지 못할 여행을 떠나보세요.',
    cta: '지금 확인하기',
  },
  loyal: {
    subject: '단골 고객님께 드리는 쿠폰',
    body: '언제나 여소남을 믿고 찾아주셔서 감사합니다. 단골 고객님을 위한 재구매 감사 쿠폰을 준비했어요. 또한, 주변에 여소남을 추천해주시면 추가 혜택을 드리는 추천인 프로그램도 함께 운영 중입니다. 더 많은 혜택을 누려보세요.',
    cta: '쿠폰 받기',
  },
  potential_loyalists: {
    subject: '두 번째 여행 준비되셨나요?',
    body: '첫 여행의 즐거운 추억이 아직 생생하신가요? 여소남이 첫 여행 스타일을 분석해 맞춤형 여행 상품을 추천해드립니다. 두 번째 여행은 더 특별하게, 당신의 취향에 딱 맞는 여행지를 발견해보세요.',
    cta: '여행 둘러보기',
  },
  new_customers: {
    subject: '웰컴! 첫 걸음을 도와드릴게요',
    body: '여소남에 오신 것을 진심으로 환영합니다! 처음 방문하시는 고객님을 위해 총 3편의 온보딩 시리즈를 준비했어요. 여행 상품 고르는 팁부터 예약까지, 첫 여행 계획을 완벽하게 도와드립니다. 게다가 두 번째 예약 시 특별 할인 혜택도 놓치지 마세요.',
    cta: '첫 여행 계획하기',
  },
  at_risk: {
    subject: '오랜만이에요, 놓치고 계신 상품이 있어요',
    body: '요즘 여소남 방문이 뜸하시네요. 그동안 여소남에는 새로운 여행 상품이 많이 추가되었습니다. 고객님의 취향을 고려해 엄선한 인기 상품 TOP 3를 확인해보세요. 오랜만에 방문하시는 고객님을 위한 특별 재활성화 할인도 준비되어 있습니다.',
    cta: '할인 확인하기',
  },
  hibernating: {
    subject: '다시 찾아온 특별한 기회',
    body: '오랜만에 인사드립니다. 여소남에서 진행하는 특별 빅세일에 초대합니다. 그동안 새롭게 추가된 여행지와 리뉴얼된 패키지를 만나보세요. 오래 기다리신 복귀 고객님께만 드리는 전용 쿠폰도 함께 준비했습니다. 이 기회를 놓치지 마세요.',
    cta: '마지막 기회',
  },
  lost: {
    subject: '여소남이 달라졌어요',
    body: '안녕하세요, 여소남입니다. 오랜만에 인사드려 죄송합니다. 그동안 여소남은 더 나은 서비스를 위해 많은 변화를 겪었습니다. 새로워진 브랜드와 함께 더욱 편리해진 예약 시스템, 그리고 더 풍성해진 여행 상품들을 준비했습니다. 파격 할인 혜택과 함께 새로워진 여소남을 경험해보세요.',
    cta: '새로워진 여소남',
  },
};

/**
 * 세그먼트 이름에 맞는 캠페인 이메일 메시지를 반환한다.
 * 등록되지 않은 세그먼트명이 들어오면 new_customers 템플릿을 기본값으로 사용한다.
 */
export function getCampaignMessageForSegment(segmentName: string): CampaignMessage {
  return SEGMENT_MESSAGES[segmentName] ?? SEGMENT_MESSAGES.new_customers;
}

// ── HTML 이메일 템플릿 ───────────────────────────────────────

const BRAND_COLOR = '#4F46E5'; // 인디고(진보라)
const BRAND_LIGHT = '#EEF2FF'; // 연한 인디고 배경
const ACCENT_COLOR = '#7C3AED'; // 바이올렛
const BG_COLOR = '#F8FAFC';
const TEXT_COLOR = '#1E293B';
const TEXT_MUTED = '#64748B';

function buildCampaignHtml(params: {
  greeting: string;
  body: string;
  cta: string;
  ctaUrl: string;
  unsubscribeUrl: string;
}): string {
  const { greeting, body, cta, ctaUrl, unsubscribeUrl } = params;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>여소남</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans KR',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${BG_COLOR}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <!-- 메일 컨테이너 -->
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08)">
          <!-- 브랜드 헤더 -->
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND_COLOR},${ACCENT_COLOR});padding:28px 32px;text-align:center">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:1px">여소남</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;font-weight:400">믿을 수 있는 여행, 합리적인 가격</p>
            </td>
          </tr>

          <!-- 본문 -->
          <tr>
            <td style="padding:32px 32px 24px">
              <!-- 개인 인사말 -->
              <p style="margin:0 0 16px;color:${TEXT_COLOR};font-size:16px;font-weight:600">${greeting}</p>

              <!-- 캠페인 본문 -->
              <p style="margin:0 0 20px;color:${TEXT_COLOR};font-size:14px;line-height:1.8">${body}</p>

              <!-- CTA 버튼 -->
              <table cellpadding="0" cellspacing="0" style="margin:24px 0">
                <tr>
                  <td style="background:linear-gradient(135deg,${BRAND_COLOR},${ACCENT_COLOR});border-radius:8px;padding:0">
                    <a href="${ctaUrl}" target="_blank"
                       style="display:inline-block;padding:13px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;letter-spacing:0.5px">
                      ${cta}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- 구분선 -->
              <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 16px">
            </td>
          </tr>

          <!-- 푸터 -->
          <tr>
            <td style="padding:0 32px 28px;text-align:center">
              <p style="margin:0;color:${TEXT_MUTED};font-size:11px;line-height:1.6">
                본 메일은 여소남 고객 세그먼트 기반 자동 발송되었습니다.<br>
                여소남 &middot; 부산광역시 해운대구 센텀중앙로 78<br>
                <a href="${unsubscribeUrl}" target="_blank"
                   style="color:${BRAND_COLOR};text-decoration:underline;font-size:11px">이메일 수신 거부</a>
              </p>
            </td>
          </tr>
        </table>

        <!-- 푸터 외부 -->
        <p style="margin:16px 0 0;color:${TEXT_MUTED};font-size:10px;text-align:center">
          &copy; ${new Date().getFullYear()} 여소남. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * 고객 이메일과 세그먼트명을 받아서 Resend API에 보낼 페이로드를 생성한다.
 *
 * - 고객 이메일 로컬파트를 이름으로 사용 (데이터 보호를 위해 DB 이름은 미사용)
 * - 도메인 앞부분을 인사말로 활용
 */
export function buildEmailPayload(
  customerEmail: string,
  segmentName: string,
): { to: string; subject: string; html: string } {
  const message = getCampaignMessageForSegment(segmentName);
  const localPart = customerEmail.split('@')[0] ?? '고객';
  const greeting = `${localPart}님, 안녕하세요!`;
  const siteUrl = (
    getSecret('NEXT_PUBLIC_SITE_URL')
    ?? process.env.NEXT_PUBLIC_SITE_URL
    ?? 'https://yeosonam.com'
  ).replace(/\/$/, '');
  const ctaUrl = `${siteUrl}/packages?utm_source=email&utm_medium=segment_campaign&utm_campaign=${segmentName}`;
  const unsubscribeUrl = `${siteUrl}/unsubscribe?email=${encodeURIComponent(customerEmail)}`;

  return {
    to: customerEmail,
    subject: message.subject,
    html: buildCampaignHtml({
      greeting,
      body: message.body,
      cta: message.cta,
      ctaUrl,
      unsubscribeUrl,
    }),
  };
}

// ── 고객 조회 ──────────────────────────────────────────────────

interface SegmentCustomer {
  customerEmail: string;
  rfmId: string | null;
}

/**
 * 특정 세그먼트에 속하고 이메일이 있는 고객 목록을 조회한다.
 * 최근 7일 이내 같은 세그먼트 캠페인을 받은 고객은 제외한다.
 */
async function fetchSegmentCustomers(
  segmentName: string,
  limit?: number,
): Promise<SegmentCustomer[]> {
  // 1) customer_segments 에서 세그먼트 ID 조회
  const { data: segData } = await supabaseAdmin
    .from('customer_segments')
    .select('id')
    .eq('segment_name', segmentName)
    .limit(1)
    .maybeSingle();

  if (!segData?.id) return [];

  const segmentId = segData.id as string;

  // 2) customer_rfm에서 세그먼트 일치 + 이메일 있는 고객 조회
  let query = supabaseAdmin
    .from('customer_rfm')
    .select('id, customer_email')
    .eq('segment_id', segmentId)
    .not('customer_email', 'is', null)
    .neq('customer_email', '')
    .order('monetary_total', { ascending: false });

  // 상위 N개만 (모든 고객에게 보내면 과도할 수 있으므로)
  if (limit && limit > 0) {
    query = query.limit(limit);
  }

  const { data: rfmRows, error } = await query;
  if (error) {
    console.error('[rfm-email-campaign] customer_rfm 조회 실패:', error.message);
    return [];
  }

  if (!rfmRows || rfmRows.length === 0) return [];

  // 3) 최근 7일 내 발송 이력 확인
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const emails = (rfmRows as Array<{ id: string; customer_email: string | null }>)
    .map(r => r.customer_email)
    .filter((e): e is string => e !== null && e.includes('@'));

  if (emails.length === 0) return [];

  const { data: recentLogs } = await supabaseAdmin
    .from('segment_campaign_logs')
    .select('customer_email')
    .eq('segment_name', segmentName)
    .in('customer_email', emails)
    .gte('sent_at', sevenDaysAgo)
    .limit(emails.length);

  const recentEmails = new Set(
    (recentLogs ?? []).map((r: any) => r.customer_email as string),
  );

  return (rfmRows as Array<{ id: string; customer_email: string | null }>)
    .filter(r => r.customer_email && !recentEmails.has(r.customer_email))
    .map(r => ({
      customerEmail: r.customer_email!,
      rfmId: r.id,
    }));
}

// ── 이메일 발송 실행 ──────────────────────────────────────────

/**
 * 단일 세그먼트 캠페인을 실행한다.
 *
 * 1. 고객 목록 조회 (7일 내 재발송 방지)
 * 2. Resend API로 이메일 발송
 * 3. segment_campaign_logs에 전송 결과 기록
 * 4. customer_rfm.last_campaign_sent_at 업데이트
 */
export async function sendSegmentCampaign(
  segmentName: string,
  limit?: number,
): Promise<SendSegmentResult> {
  const resendKey = getSecret('RESEND_API_KEY');
  if (!resendKey) {
    console.warn('[rfm-email-campaign] RESEND_API_KEY 미설정 — 캠페인 skip');
    return { sent: 0, failed: 0, errors: ['RESEND_API_KEY not configured'] };
  }
  if (!isSupabaseConfigured) {
    return { sent: 0, failed: 0, errors: ['Supabase not configured'] };
  }

  const customers = await fetchSegmentCustomers(segmentName, limit);
  if (customers.length === 0) {
    console.log(`[rfm-email-campaign] '${segmentName}' 세그먼트 발송 대상 없음`);
    return { sent: 0, failed: 0, errors: [] };
  }

  const resend = new Resend(resendKey);
  const from = getSecret('RESEND_FROM_EMAIL') ?? 'noreply@yeosonam.com';
  const campaignRunId = crypto.randomUUID();
  const errors: string[] = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    const payload = buildEmailPayload(customer.customerEmail, segmentName);

    try {
      const res = await resend.emails.send({
        from: `여소남 <${from}>`,
        to: customer.customerEmail,
        subject: payload.subject,
        html: payload.html,
      });

      const resendMessageId = ((res as Record<string, unknown>)?.data as Record<string, unknown>)?.id ?? null;

      // segment_campaign_logs 저장 (발송 성공)
      await supabaseAdmin.from('segment_campaign_logs').insert({
        campaign_run_id: campaignRunId,
        segment_name: segmentName,
        customer_email: customer.customerEmail,
        resend_message_id: resendMessageId,
        status: 'sent',
      } as never);

      // customer_rfm.last_campaign_sent_at 업데이트
      if (customer.rfmId) {
        await supabaseAdmin
          .from('customer_rfm')
          .update({ last_campaign_sent_at: new Date().toISOString() })
          .eq('id', customer.rfmId);
      }

      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '알 수 없는 오류';
      errors.push(`[${customer.customerEmail}] ${errMsg}`);
      console.warn(
        `[rfm-email-campaign] '${segmentName}' 발송 실패 (${customer.customerEmail}):`,
        errMsg,
      );

      // 실패 로그 저장
      await supabaseAdmin.from('segment_campaign_logs').insert({
        campaign_run_id: campaignRunId,
        segment_name: segmentName,
        customer_email: customer.customerEmail,
        status: 'failed',
        error_message: errMsg,
      } as never);

      failed++;
    }

    // Rate limit 방어: Resend 무료 티어 2req/s → 500ms 간격
    if (i < customers.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(
    `[rfm-email-campaign] '${segmentName}' 완료: ${sent} sent, ${failed} failed (${errors.length} errors)`,
  );

  return { sent, failed, errors };
}

// ── 전체 세그먼트 순차 실행 ──────────────────────────────────

const ALL_SEGMENTS = [
  'champions',
  'loyal',
  'potential_loyalists',
  'new_customers',
  'at_risk',
  'hibernating',
  'lost',
] as const;

/**
 * 7개 전체 세그먼트 캠페인을 순차적으로 실행한다.
 * 세그먼트 간 2초 간격을 둔다 (Resend API rate limit + DB 부하 방지).
 */
export async function runAllSegmentCampaigns(): Promise<CampaignResult[]> {
  const results: CampaignResult[] = [];

  for (const segment of ALL_SEGMENTS) {
    console.log(`[rfm-email-campaign] ==== '${segment}' 캠페인 시작 ====`);
    const result = await sendSegmentCampaign(segment);

    results.push({
      segment,
      sent: result.sent,
      failed: result.failed,
    });

    if (result.errors.length > 0) {
      console.warn(
        `[rfm-email-campaign] '${segment}' 오류 ${result.errors.length}건:`,
        result.errors.slice(0, 3).join(', '),
        result.errors.length > 3 ? ` 외 ${result.errors.length - 3}건` : '',
      );
    }

    // 세그먼트 간 2초 간격 (API 부하 분산)
    if (segment !== ALL_SEGMENTS[ALL_SEGMENTS.length - 1]) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

// ── 로그 정리 ──────────────────────────────────────────────────

/**
 * 90일 이전 segment_campaign_logs를 삭제한다.
 * 주 1회 크론 등에서 호출한다.
 */
export async function refreshSegmentCampaignLog(): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: deleted, error } = await supabaseAdmin
    .from('segment_campaign_logs')
    .delete()
    .lt('sent_at', cutoff)
    .select('id');

  if (error) {
    console.error('[rfm-email-campaign] 로그 정리 실패:', error.message);
    return;
  }

  console.log(
    `[rfm-email-campaign] 로그 정리 완료: ${(deleted ?? []).length}개 삭제 (${cutoff.slice(0, 10)} 이전)`,
  );
}
