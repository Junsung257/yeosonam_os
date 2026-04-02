import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

// GET: 파트너 신청 목록
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ applications: [] });

  const { searchParams } = request.nextUrl;
  const status = searchParams.get('status') || undefined;

  let query = supabaseAdmin
    .from('affiliate_applications')
    .select('*')
    .order('applied_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ applications: data || [] });
}

// POST: 승인 또는 거절
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  try {
    const body = await request.json();
    const { applicationId, action, reject_reason } = body;

    if (!applicationId || !action) {
      return NextResponse.json({ error: 'applicationId, action 필수' }, { status: 400 });
    }

    // 신청 조회
    const { data: app, error: appErr } = await supabaseAdmin
      .from('affiliate_applications')
      .select('*')
      .eq('id', applicationId)
      .single();

    if (appErr || !app) return NextResponse.json({ error: '신청을 찾을 수 없습니다.' }, { status: 404 });
    if (app.status !== 'PENDING') return NextResponse.json({ error: '이미 처리된 신청입니다.' }, { status: 409 });

    if (action === 'approve') {
      // PIN 생성 (전화번호 뒷 4자리)
      const pin = app.phone.replace(/[^0-9]/g, '').slice(-4) || '0000';

      // 추천코드 생성 (혼동 문자 제외 6자리 + DB 중복 체크)
      const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0,O,1,I 제외
      let code = '';
      for (let attempt = 0; attempt < 10; attempt++) {
        const suffix = Array.from({ length: 6 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
        const candidate = `${app.name.replace(/[^a-zA-Z가-힣]/g, '').slice(0, 4).toUpperCase()}_${suffix}`;
        const { count } = await supabaseAdmin
          .from('affiliates')
          .select('*', { count: 'exact', head: true })
          .eq('referral_code', candidate);
        if (!count || count === 0) { code = candidate; break; }
      }
      if (!code) code = `YSN_${Date.now().toString(36).toUpperCase().slice(-6)}`;

      // affiliates 테이블에 생성
      const { data: affiliate, error: affErr } = await supabaseAdmin
        .from('affiliates')
        .insert({
          name: app.name,
          phone: app.phone,
          referral_code: code,
          pin,
          payout_type: app.business_type === 'business' ? 'BUSINESS' : 'PERSONAL',
          business_number: app.business_number || null,
          commission_rate: 0.09,
          is_active: true,
          memo: `채널: ${app.channel_type} / ${app.channel_url}${app.intro ? ` / ${app.intro}` : ''}`,
        })
        .select()
        .single();

      if (affErr) throw affErr;

      // 신청 상태 업데이트
      await supabaseAdmin
        .from('affiliate_applications')
        .update({
          status: 'APPROVED',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', applicationId);

      // 승인 알림 발송 (알림톡 or SMS)
      try {
        const { getNotificationAdapter } = await import('@/lib/notification-adapter');
        const adapter = getNotificationAdapter();
        const portalUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://yesonam.co.kr'}/influencer/${code}`;
        await adapter.send({
          bookingId: affiliate.id,
          eventType: 'PARTNER_APPROVED' as any,
          title: '파트너 승인 완료',
          content: `[여소남] ${app.name}님, 파트너 승인이 완료되었습니다!\n추천코드: ${code}\nPIN: ${pin}\n포털: ${portalUrl}`,
          customerName: app.name,
          customerPhone: app.phone,
        });
      } catch (notifyErr) {
        console.warn('[Applications] 승인 알림 발송 실패:', notifyErr);
      }

      return NextResponse.json({ affiliate, message: '승인 완료' });

    } else if (action === 'reject') {
      await supabaseAdmin
        .from('affiliate_applications')
        .update({
          status: 'REJECTED',
          reject_reason: reject_reason || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', applicationId);

      return NextResponse.json({ message: '거절 완료' });
    }

    return NextResponse.json({ error: 'action은 approve 또는 reject' }, { status: 400 });
  } catch (error) {
    console.error('[Applications]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '처리 실패' },
      { status: 500 }
    );
  }
}
