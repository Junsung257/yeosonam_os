import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  publishCarouselToInstagram,
  isInstagramConfigured,
  getInstagramConfig,
} from '@/lib/instagram-publisher';

export const maxDuration = 120;  // Meta 컨테이너 폴링까지 최대 90초 + 마진

/**
 * POST /api/card-news/[id]/publish-instagram
 *
 * Body:
 *   when: 'now' | 'scheduled'
 *   scheduled_for?: ISO string (when='scheduled'일 때 필수)
 *   caption: string
 *   image_urls?: string[]  // 생략 시 card_news.slides[].bg_image_url 또는 슬라이드 캡처 URL 사용
 *
 * 동작:
 *   - when='now' → 즉시 Meta Graph API 호출 (동기 처리, 60~90초 소요 가능)
 *   - when='scheduled' → DB에 queued 저장만, 크론(/api/cron/agent-executor)이 처리
 *
 * 실패 시 card_news.ig_publish_status='failed', ig_error 저장.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const { id } = params;

  try {
    const body = await request.json();
    const { when, scheduled_for, caption, image_urls } = body as {
      when: 'now' | 'scheduled';
      scheduled_for?: string;
      caption: string;
      image_urls?: string[];
    };

    if (!caption || !caption.trim()) {
      return NextResponse.json({ error: '캡션 필수' }, { status: 400 });
    }
    if (when !== 'now' && when !== 'scheduled') {
      return NextResponse.json({ error: 'when은 now 또는 scheduled' }, { status: 400 });
    }
    if (when === 'scheduled' && !scheduled_for) {
      return NextResponse.json({ error: '예약 발행은 scheduled_for 필수' }, { status: 400 });
    }

    // 카드뉴스 조회
    const { data: cn, error: cnErr } = await supabaseAdmin
      .from('card_news')
      .select('id, slides, title, ig_publish_status')
      .eq('id', id)
      .single();
    if (cnErr || !cn) {
      return NextResponse.json({ error: '카드뉴스 없음' }, { status: 404 });
    }

    // 이미지 URL 확정 (파라미터 > slide.bg_image_url)
    const slides = Array.isArray(cn.slides) ? cn.slides : [];
    const resolvedUrls: string[] = (image_urls && image_urls.length > 0)
      ? image_urls
      : slides.map((s: any) => s?.bg_image_url).filter((u: any) => typeof u === 'string' && u.length > 0);

    if (resolvedUrls.length < 2 || resolvedUrls.length > 10) {
      return NextResponse.json(
        { error: `캐러셀 이미지 2~10장 필요 (현재 ${resolvedUrls.length}장). 먼저 슬라이드를 캡처하세요.` },
        { status: 400 },
      );
    }

    // data: URL은 Meta가 거부 → 공개 https URL만 허용
    const nonPublic = resolvedUrls.find(u => !u.startsWith('http://') && !u.startsWith('https://'));
    if (nonPublic) {
      return NextResponse.json(
        { error: '이미지가 공개 URL(https)이 아닙니다. "확정+블로그" 먼저 실행해 슬라이드 PNG를 업로드하세요.' },
        { status: 400 },
      );
    }

    // ── 예약 발행 ──────────────────────────────────────────
    if (when === 'scheduled') {
      const scheduledAt = new Date(scheduled_for!);
      if (isNaN(scheduledAt.getTime())) {
        return NextResponse.json({ error: 'scheduled_for 파싱 실패' }, { status: 400 });
      }
      const { error } = await supabaseAdmin
        .from('card_news')
        .update({
          ig_publish_status: 'queued',
          ig_scheduled_for: scheduledAt.toISOString(),
          ig_caption: caption,
          ig_slide_urls: resolvedUrls,
          ig_error: null,
        })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({
        ok: true,
        mode: 'scheduled',
        scheduled_for: scheduledAt.toISOString(),
      });
    }

    // ── 즉시 발행 ──────────────────────────────────────────
    if (!isInstagramConfigured()) {
      return NextResponse.json(
        { error: 'META_IG_USER_ID 또는 META_ACCESS_TOKEN 미설정. 환경변수 확인하세요.' },
        { status: 503 },
      );
    }
    const cfg = getInstagramConfig()!;

    // 상태: publishing
    await supabaseAdmin
      .from('card_news')
      .update({
        ig_publish_status: 'publishing',
        ig_caption: caption,
        ig_slide_urls: resolvedUrls,
        ig_error: null,
      })
      .eq('id', id);

    const result = await publishCarouselToInstagram({
      igUserId: cfg.igUserId,
      accessToken: cfg.accessToken,
      imageUrls: resolvedUrls,
      caption,
    });

    if (!result.ok) {
      await supabaseAdmin
        .from('card_news')
        .update({
          ig_publish_status: 'failed',
          ig_error: `[${result.step}] ${result.error}`,
        })
        .eq('id', id);
      return NextResponse.json(
        { ok: false, step: result.step, error: result.error },
        { status: 500 },
      );
    }

    // 성공
    await supabaseAdmin
      .from('card_news')
      .update({
        ig_publish_status: 'published',
        ig_post_id: result.postId,
        ig_published_at: new Date().toISOString(),
        ig_error: null,
      })
      .eq('id', id);

    return NextResponse.json({ ok: true, mode: 'now', post_id: result.postId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[publish-instagram] unexpected', msg);
    // 가능한 경우 DB 상태도 failed로
    try {
      await supabaseAdmin
        .from('card_news')
        .update({ ig_publish_status: 'failed', ig_error: msg })
        .eq('id', id);
    } catch { /* noop */ }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
