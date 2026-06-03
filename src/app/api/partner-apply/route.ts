import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';

function normalizeChannelUrl(raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withScheme);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return value.toLowerCase();
  }
}

function scoreApplicationRisk(input: {
  channelUrl: string;
  followerCount: number | null;
  hasInviteCode: boolean;
  intro: string | null;
}) {
  const reasons: string[] = [];
  let score = 0;
  if (!/^https?:\/\//i.test(input.channelUrl)) {
    score += 25;
    reasons.push('invalid_or_unparsed_channel_url');
  }
  if (!input.hasInviteCode) {
    score += 20;
    reasons.push('no_invite_code');
  }
  if ((input.followerCount || 0) < 100) {
    score += 20;
    reasons.push('low_follower_count');
  }
  if (!input.intro || input.intro.trim().length < 10) {
    score += 15;
    reasons.push('thin_intro');
  }
  return { score: Math.min(100, score), reasons };
}

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

    // 초대 코드 정책 (하이브리드):
    // - AFFILIATE_INVITE_CODES 가 설정되어 있으면 해당 코드 보유자는 우선심사
    // - 초대 코드가 없어도 신청 가능 (has_invite_code=false 로 기록)
    const invitePolicy = (getSecret('AFFILIATE_INVITE_CODES') || '').trim();
    const submittedCode = String(invite_code || '').trim().toUpperCase();
    if (invitePolicy) {
      const allow = invitePolicy
        .split(',')
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean);
      if (submittedCode && !allow.includes(submittedCode)) {
        return NextResponse.json(
          { error: '초대 코드가 유효하지 않습니다. 운영팀 코드를 확인해 주세요.' },
          { status: 403 }
        );
      }
    }

    const channelUrlNormalized = normalizeChannelUrl(channel_url);
    const termsAccepted = body.terms_accepted === true || body.termsAccepted === true;
    const disclosureAck = body.disclosure_ack === true || body.disclosureAck === true;
    const nowIso = new Date().toISOString();
    const risk = scoreApplicationRisk({
      channelUrl: channelUrlNormalized,
      followerCount: Number.isFinite(Number(follower_count)) ? Number(follower_count) : null,
      hasInviteCode: !!submittedCode,
      intro: typeof intro === 'string' ? intro : null,
    });

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
        channel_url_normalized: channelUrlNormalized,
        follower_count: follower_count || null,
        intro: intro || null,
        business_type: business_type || 'individual',
        business_number: business_number || null,
        has_invite_code: !!submittedCode,
        terms_accepted_at: termsAccepted ? nowIso : null,
        disclosure_ack_at: disclosureAck ? nowIso : null,
        application_risk_score: risk.score,
        risk_reasons: risk.reasons,
      } as never)
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
