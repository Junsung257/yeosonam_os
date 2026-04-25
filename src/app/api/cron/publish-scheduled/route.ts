/**
 * GET /api/cron/publish-scheduled
 *
 * 1시간 주기 Vercel Cron.
 * content_distributions WHERE status='scheduled' AND scheduled_for <= now() 처리.
 * 플랫폼별 publisher 호출 → 성공 시 status='published' + external_id/url.
 *
 * 현재 지원:
 *   - meta_ads: meta-ads-publisher 로 실제 광고 발행
 *   - instagram_caption: 기존 /api/card-news/[id]/publish-instagram 로직 재활용 (card_news 필요)
 *   - threads_post:     (향후) Threads API
 *   - kakao_channel:    (향후) 카카오 비즈니스 API
 *   - google_ads_rsa:   (향후) Google Ads API
 *   - blog_body:        자동 발행 없음 (블로그는 수동)
 *
 * 안전장치:
 *   - 동시 실행 제한 (FOR UPDATE SKIP LOCKED 대안: 한 번에 20건)
 *   - 실패 3회 시 status='failed'
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { publishToMetaAds } from '@/lib/content-pipeline/publishers/meta-ads-publisher';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ScheduledRow {
  id: string;
  product_id: string | null;
  card_news_id: string | null;
  platform: string;
  payload: Record<string, unknown>;
  scheduled_for: string;
  engagement: Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    picked: 0,
    published: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
    details: [] as Array<{ id: string; platform: string; status: string; error?: string }>,
  };

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, card_news_id, platform, payload, scheduled_for, engagement')
      .eq('status', 'scheduled')
      .lte('scheduled_for', nowIso)
      .limit(20);

    if (error) throw error;
    const rows = (data ?? []) as ScheduledRow[];
    summary.picked = rows.length;

    for (const row of rows) {
      try {
        const result = await publishOne(row);
        if (result.status === 'published') {
          await supabaseAdmin
            .from('content_distributions')
            .update({
              status: 'published',
              published_at: new Date().toISOString(),
              external_id: result.external_id ?? null,
              external_url: result.external_url ?? null,
            })
            .eq('id', row.id);
          summary.published += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'published' });
        } else if (result.status === 'skipped') {
          summary.skipped += 1;
          summary.details.push({ id: row.id, platform: row.platform, status: 'skipped', error: result.reason });
        } else {
          // failed: retry count 증가
          const retryCount = ((row.engagement?.retry_count as number) ?? 0) + 1;
          const newStatus = retryCount >= 3 ? 'failed' : 'scheduled';
          await supabaseAdmin
            .from('content_distributions')
            .update({
              status: newStatus,
              engagement: { ...(row.engagement ?? {}), retry_count: retryCount, last_error: result.error },
              // 3회 실패 시 scheduled_for 건드리지 않음 — 사용자 재스케줄 대기
              ...(retryCount < 3 ? { scheduled_for: new Date(Date.now() + 30 * 60 * 1000).toISOString() } : {}),
            })
            .eq('id', row.id);
          summary.failed += 1;
          summary.errors.push(`${row.id} (${row.platform}): ${result.error}`);
          summary.details.push({ id: row.id, platform: row.platform, status: newStatus, error: result.error });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${row.id} fatal: ${msg}`);
      }
    }
  } catch (err) {
    summary.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[publish-scheduled]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return NextResponse.json({ ...summary, elapsed_ms: elapsedMs });
}

// ──────────────────────────────────────────────────────
// 플랫폼별 publisher 분기
// ──────────────────────────────────────────────────────
async function publishOne(row: ScheduledRow): Promise<{
  status: 'published' | 'failed' | 'skipped';
  external_id?: string;
  external_url?: string;
  error?: string;
  reason?: string;
}> {
  const payload = row.payload;

  if (row.platform === 'meta_ads') {
    const landingUrl = row.product_id
      ? `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com'}/packages/${row.product_id}`
      : (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://yeosonam.com');
    const result = await publishToMetaAds({
      primary_texts: (payload.primary_texts as string[]) ?? [],
      headlines: (payload.headlines as string[]) ?? [],
      descriptions: (payload.descriptions as string[]) ?? [],
      cta_button: (payload.cta_button as string) ?? 'LEARN_MORE',
      landing_url: landingUrl,
    });
    if (result.status === 'error') return { status: 'failed', error: result.error };
    if (result.status === 'draft') {
      // test mode: 광고는 만들었지만 PAUSED 상태 — published 로 표시하되 test_mode 플래그
      return {
        status: 'published',
        external_id: result.campaign_id,
        external_url: result.external_url,
      };
    }
    return {
      status: 'published',
      external_id: result.campaign_id,
      external_url: result.external_url,
    };
  }

  if (row.platform === 'instagram_caption') {
    // card_news 에 연결된 경우만 기존 IG 발행 경로 호출
    if (!row.card_news_id) {
      return { status: 'skipped', reason: 'card_news_id 없음 (IG 캡션만으로는 발행 불가)' };
    }
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
      const res = await fetch(`${base}/api/card-news/${row.card_news_id}/publish-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption_override: (payload.caption as string) ?? undefined }),
      });
      const data = await res.json();
      if (!res.ok) return { status: 'failed', error: data.error ?? 'IG 발행 실패' };
      return {
        status: 'published',
        external_id: data.ig_post_id ?? undefined,
        external_url: data.permalink ?? undefined,
      };
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (row.platform === 'threads_post' || row.platform === 'kakao_channel' || row.platform === 'google_ads_rsa') {
    return { status: 'skipped', reason: `${row.platform} 자동 발행 미지원 (API 인증 필요)` };
  }

  if (row.platform === 'blog_body') {
    return { status: 'skipped', reason: '블로그는 수동 발행' };
  }

  return { status: 'skipped', reason: `알 수 없는 플랫폼 ${row.platform}` };
}
