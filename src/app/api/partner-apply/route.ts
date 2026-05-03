import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { name, phone, channel_type, channel_url, follower_count, intro, business_type, business_number, invite_code } = body;

    if (!name || !phone || !channel_type || !channel_url) {
      return NextResponse.json({ error: '이름, 연락처, 채널유형, 채널URL은 필수입니다.' }, { status: 400 });
    }

    // Invite-only 운영: AFFILIATE_INVITE_CODES="CODE1,CODE2"
    const invitePolicy = (process.env.AFFILIATE_INVITE_CODES || '').trim();
    if (invitePolicy) {
      const allow = invitePolicy
        .split(',')
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean);
      const submitted = String(invite_code || '').trim().toUpperCase();
      if (!submitted || !allow.includes(submitted)) {
        return NextResponse.json(
          { error: '초대 코드가 필요하거나 유효하지 않습니다. 운영팀 초대 코드를 확인해 주세요.' },
          { status: 403 }
        );
      }
    }

    // 중복 신청 확인
    const { data: existing } = await supabaseAdmin
      .from('affiliate_applications')
      .select('id, status')
      .eq('phone', phone)
      .in('status', ['PENDING', 'APPROVED'])
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: existing.status === 'APPROVED' ? '이미 승인된 파트너입니다.' : '이미 신청이 접수되어 있습니다.' },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('affiliate_applications')
      .insert({
        name,
        phone,
        channel_type,
        channel_url,
        follower_count: follower_count || null,
        intro: intro || null,
        business_type: business_type || 'individual',
        business_number: business_number || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ application: data }, { status: 201 });
  } catch (error) {
    console.error('[Partner Apply]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '신청 실패' },
      { status: 500 }
    );
  }
}
