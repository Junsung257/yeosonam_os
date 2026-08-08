import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import { apiResponse } from '@/lib/api-response';
import { logAndSanitize } from '@/lib/error-sanitizer';
import {
  AFFILIATE_TERMS_BUNDLE_VERSION,
  buildAffiliateApplicationIdempotencyKey,
  isPostgresUniqueViolation,
  normalizeAffiliatePhone,
} from '@/lib/affiliate/application-contract';
import { recordAffiliateFunnelEvent } from '@/lib/affiliate/funnel-events';

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
    return apiResponse({ error: '신청 서비스를 사용할 수 없습니다.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { name, phone, channel_type, channel_url, follower_count, intro, business_type, business_number, invite_code } = body;

    if (!name || !phone || !channel_type || !channel_url) {
      return apiResponse({ error: '이름, 연락처, 채널유형, 채널URL은 필수입니다.' }, { status: 400 });
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
        return apiResponse(
          { error: '초대 코드가 유효하지 않습니다. 운영팀 코드를 확인해 주세요.' },
          { status: 403 }
        );
      }
    }

    const channelUrlNormalized = normalizeChannelUrl(channel_url);
    const termsAccepted = body.terms_accepted === true || body.termsAccepted === true;
    const disclosureAck = body.disclosure_ack === true || body.disclosureAck === true;
    if (!termsAccepted || !disclosureAck) {
      return apiResponse(
        { error: '파트너 정책과 광고 표시 의무를 모두 확인해 주세요.' },
        { status: 400 },
      );
    }

    const normalizedPhone = normalizeAffiliatePhone(phone);
    if (!/^\d{8,15}$/.test(normalizedPhone)) {
      return apiResponse({ error: '연락처 형식을 확인해 주세요.' }, { status: 400 });
    }
    const idempotencyKey = buildAffiliateApplicationIdempotencyKey({
      requestedKey: request.headers.get('idempotency-key'),
      normalizedPhone,
      normalizedChannelUrl: channelUrlNormalized,
    });
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
      .eq('normalized_phone', normalizedPhone)
      .in('status', ['PENDING', 'APPROVED'])
      .maybeSingle();

    if (existing) {
      return apiResponse(
        { error: existing.status === 'APPROVED' ? '이미 승인된 파트너입니다.' : '이미 신청이 접수되어 있습니다.' },
        { status: 409 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('affiliate_applications')
      .insert({
        name,
        phone,
        normalized_phone: normalizedPhone,
        channel_type,
        channel_url,
        channel_url_normalized: channelUrlNormalized,
        follower_count: follower_count || null,
        intro: intro || null,
        business_type: business_type || 'individual',
        business_number: business_number || null,
        has_invite_code: !!submittedCode,
        terms_accepted_at: nowIso,
        disclosure_ack_at: nowIso,
        terms_bundle_version: AFFILIATE_TERMS_BUNDLE_VERSION,
        idempotency_key: idempotencyKey,
        application_risk_score: risk.score,
        risk_reasons: risk.reasons,
      } as never)
      .select('id, status, applied_at')
      .single();

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        return apiResponse({ error: '이미 신청이 접수되어 있습니다.' }, { status: 409 });
      }
      throw error;
    }

    await recordAffiliateFunnelEvent({
      eventName: 'affiliate_application_submitted',
      actorType: 'customer',
      traceId: idempotencyKey,
      idempotencyKey: `application-submitted:${data.id}`,
      payload: {
        application_status: data.status,
        terms_bundle_version: AFFILIATE_TERMS_BUNDLE_VERSION,
        has_invite_code: !!submittedCode,
      },
    });

    return apiResponse({ application: data }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_IDEMPOTENCY_KEY') {
      return apiResponse({ error: '요청 식별자 형식이 올바르지 않습니다.' }, { status: 400 });
    }
    logAndSanitize('partner-apply', error, '신청 처리에 실패했습니다.');
    return apiResponse({ error: '신청 처리에 실패했습니다.' }, { status: 500 });
  }
}
