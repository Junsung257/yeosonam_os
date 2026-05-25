/**
 * POST /api/affiliate/card-news
 *
 * 어필리에이터가 카드뉴스를 생성합니다.
 * - 쿼터 체크
 * - branding_level 적용
 * - 생성 후 사용량 증가
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { checkAffiliateContentQuota, incrementAffiliateContentUsage, logAffiliateMonthlyUsage } from '@/lib/card-news/affiliate-quota';
import { getAffiliateBrandKit, buildBrandOverrides } from '@/lib/card-news/brand-kit';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const maxDuration = 120;

function verifyToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const secret = process.env.AFFILIATE_TOKEN_SECRET || process.env.SUPABASE_JWT_SECRET || 'dev-secret-change-in-prod';
    const expectedHmac = crypto.createHmac('sha256', secret).update(parts[0]).digest('hex');
    if (parts[1] !== expectedHmac) return null;
    return payload.affiliate_id;
  } catch {
    return null;
  }
}

interface RequestBody {
  title?: string;
  topic?: string;
  template_family?: string;
  slides?: Array<{
    headline: string;
    body: string;
    badge?: string | null;
    bg_image_url?: string;
  }>;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  // 토큰 인증
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }
  const affiliateId = verifyToken(auth.slice(7));
  if (!affiliateId) {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as RequestBody;
    const effectiveTitle = body.title || body.topic || '';
    if (!effectiveTitle) {
      return NextResponse.json({ error: 'title 또는 topic은 필수입니다' }, { status: 400 });
    }

    // 1. 쿼터 체크
    const quota = await checkAffiliateContentQuota(affiliateId);
    if (!quota.allowed) {
      return NextResponse.json({ error: quota.reason }, { status: 403 });
    }

    // 2. 브랜드 킷 조회
    const brandKit = await getAffiliateBrandKit(affiliateId);
    const brandOverrides = buildBrandOverrides(brandKit, quota.brandingLevel);

    // 3. 슬라이드 준비
    const slides = body.slides && body.slides.length > 0
      ? body.slides.map((s, i) => ({
          id: `slide-${Date.now()}-${i}`,
          position: i,
          headline: s.headline,
          body: s.body,
          badge: s.badge || null,
          bg_image_url: s.bg_image_url || '',
        }))
      : [
          { id: `slide-${Date.now()}-0`, position: 0, headline: effectiveTitle, body: '여소남과 함께하는 특별한 여행', badge: '추천', bg_image_url: '' },
          { id: `slide-${Date.now()}-1`, position: 1, headline: '문의하기', body: '지금 바로 상담 받아보세요', badge: '문의', bg_image_url: '' },
        ];

    // 4. 카드뉴스 DB 저장
    const now = new Date().toISOString();
    const { data: cardNews, error: insertError } = await supabaseAdmin
      .from('card_news')
      .insert({
        title: effectiveTitle,
        slides,
        status: 'DRAFT',
        template_family: body.template_family || 'editorial',
        template_version: 'v2',
        created_by_affiliate_id: affiliateId,
        branding_level: quota.brandingLevel,
        is_affiliate_content: true,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError || !cardNews) {
      return NextResponse.json({ error: `카드뉴스 생성 실패: ${insertError?.message}` }, { status: 500 });
    }

    // 5. 사용량 증가
    await incrementAffiliateContentUsage(affiliateId);
    const monthStr = now.slice(0, 7) + '-01';
    await logAffiliateMonthlyUsage(affiliateId, monthStr, { content_generated: 1 });

    return NextResponse.json({
      success: true,
      card_news_id: cardNews.id,
      slides,
      brandOverrides,
      quotaRemaining: quota.quotaRemaining - 1,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/affiliate/card-news
 *
 * 어필리에이터의 카드뉴스 목록 조회 (토큰 기반 인증)
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 });
  }

  // 토큰에서 affiliate_id 추출
  const affiliateId = verifyToken(auth.slice(7));
  if (!affiliateId) {
    return NextResponse.json({ error: '유효하지 않은 토큰' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('card_news')
    .select('id, title, title_slides, status, created_at, updated_at, views, clicks, scheduled_at')
    .eq('created_by_affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: data || [] });
}
