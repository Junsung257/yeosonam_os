/**
 * EngagementAgent — 미전환 리드에게 리타겟 이메일 발송
 *
 * 재사용: Resend API (va-email.ts 패턴)
 * RESEND_API_KEY 미설정 시 skip
 */
import { Resend } from 'resend';
import { BaseMarketingAgent, type MarketingContext, type AgentResult } from '../base-agent';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

const BATCH_LIMIT = 50; // 1회 최대 발송 수

export class EngagementAgent extends BaseMarketingAgent {
  readonly name = 'engagement';

  async run(ctx: MarketingContext): Promise<Omit<AgentResult, 'elapsed_ms'>> {
    const resendKey = getSecret('RESEND_API_KEY');
    if (!resendKey) return this.skip('RESEND_API_KEY 미설정');
    if (!isSupabaseConfigured) return this.skip('Supabase 미설정');

    // 7일 전 이후 생성된 pending 예약 중 이메일 있는 고객
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leads, error } = await supabaseAdmin
      .from('bookings')
      .select(`
        id,
        created_at,
        customers!lead_customer_id (
          name,
          email,
          phone
        ),
        travel_packages!package_id (
          title,
          destination
        )
      `)
      .eq('status', 'pending')
      .gte('created_at', sevenDaysAgo)
      .not('lead_customer_id', 'is', null)
      .limit(BATCH_LIMIT);

    if (error) throw error;
    if (!leads?.length) return { ok: true, data: { sent: 0, reason: '발송 대상 없음' } };

    const resend = new Resend(resendKey);
    let sent = 0;
    let failed = 0;

    for (const lead of leads) {
      const customer = lead.customers as { name?: string; email?: string } | null;
      const pkg = lead.travel_packages as { title?: string; destination?: string } | null;

      if (!customer?.email || !customer.email.includes('@')) continue;

      try {
        await resend.emails.send({
          from: getSecret('RESEND_FROM_EMAIL') ?? 'noreply@yeosonam.com',
          to: customer.email,
          subject: `${pkg?.destination ?? '여행지'} 여행 — 아직 고민 중이신가요?`,
          html: buildRetargetHtml({
            name: customer.name ?? '고객',
            packageTitle: pkg?.title ?? '패키지 여행',
            destination: pkg?.destination ?? '여행지',
          }),
        });
        sent++;
      } catch (err) {
        console.warn('[engagement-agent] 이메일 발송 실패:', err);
        failed++;
      }

      // Rate limit 방어 (Resend: 2 req/s free tier)
      await new Promise(r => setTimeout(r, 500));
    }

    return { ok: true, data: { sent, failed, total_leads: leads.length } };
  }
}

function buildRetargetHtml(params: {
  name: string;
  packageTitle: string;
  destination: string;
}): string {
  const { name, packageTitle, destination } = params;
  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <h2 style="color:#1a1a1a">${name}님, ${destination} 여행 아직 고민 중이신가요?</h2>
  <p>지난번에 살펴보신 <strong>${packageTitle}</strong>가 아직 예약 가능합니다.</p>
  <p>여소남이 엄선한 노팁·노옵션 패키지로 편안한 여행을 즐기세요.</p>
  <a href="${getSecret('NEXT_PUBLIC_SITE_URL') ?? 'https://yeosonam.com'}/packages"
     style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin-top:16px">
    패키지 다시 보기
  </a>
  <p style="color:#666;font-size:12px;margin-top:32px">
    수신 거부를 원하시면 답장으로 알려주세요.
  </p>
</body>
</html>`;
}
