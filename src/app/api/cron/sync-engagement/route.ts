/**
 * GET /api/cron/sync-engagement
 *
 * 24h 주기 Vercel Cron.
 * 발행된 content_distributions (status='published' + external_id 있음) 를 조회해
 * 플랫폼별 Graph API 로 engagement 지표 수집 → engagement JSONB 업데이트.
 * 성과 상위 20% 는 brand-voice.appendVoiceSample() 로 자동 학습.
 *
 * 보안: Vercel cron 은 Authorization 헤더로 자기 자신을 식별. CRON_SECRET env 필요.
 *
 * 플랫폼별 경로:
 *   - instagram_caption: Meta Graph API (기존 ig_post_id)
 *   - threads_post:       Threads API (public beta, 2026 기준 공식 출시)
 *   - meta_ads:           Meta Ads Insights API (ad 단위 metrics)
 *   - kakao_channel:      카카오 비즈니스 수신 리포트 API
 *
 * 인증 필요 플랫폼은 env 미설정 시 skip.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { appendVoiceSample } from '@/lib/content-pipeline/brand-voice';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface DistributionRow {
  id: string;
  platform: string;
  external_id: string | null;
  external_url: string | null;
  payload: Record<string, unknown>;
  engagement: Record<string, unknown>;
  published_at: string | null;
}

export async function GET(request: NextRequest) {
  // 보안 체크
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.CRON_SECRET && authHeader !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    checked: 0,
    updated: 0,
    top_performers_added: 0,
    errors: [] as string[],
  };

  try {
    // 1. 발행된 배포만 조회 (최근 30일)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('content_distributions')
      .select('id, platform, external_id, external_url, payload, engagement, published_at')
      .eq('status', 'published')
      .gte('published_at', thirtyDaysAgo)
      .not('external_id', 'is', null)
      .limit(200);

    if (error) throw error;
    const rows = (data ?? []) as DistributionRow[];
    summary.checked = rows.length;

    const performanceScores: Array<{ row: DistributionRow; score: number }> = [];

    // 2. 플랫폼별 병렬 sync
    for (const row of rows) {
      try {
        let metrics: Record<string, number> = {};
        let score = 0;

        if (row.platform === 'instagram_caption' && row.external_id) {
          const igResult = await fetchInstagramMetrics(row.external_id);
          if (igResult) {
            metrics = igResult;
            // performance_score = (saves * 5 + shares * 3 + likes + comments * 2) / impressions
            const impressions = igResult.impressions || 1;
            score = Math.min(1,
              ((igResult.saved ?? 0) * 5 + (igResult.shares ?? 0) * 3 + (igResult.likes ?? 0) + (igResult.comments ?? 0) * 2)
              / impressions,
            );
          }
        } else if (row.platform === 'threads_post') {
          // Threads 는 아직 제한된 API. 수동 입력 또는 skip.
          // TODO: Threads Graph API 정식 출시 시 여기 구현
        } else if (row.platform === 'meta_ads' && row.external_id) {
          const adsResult = await fetchMetaAdsMetrics(row.external_id);
          if (adsResult) {
            metrics = adsResult;
            score = Math.min(1, (adsResult.ctr ?? 0) * 20);  // CTR 5% = score 1.0
          }
        } else if (row.platform === 'kakao_channel' && row.external_id) {
          // 카카오 비즈니스 리포트 API — skip if no token
        }

        if (Object.keys(metrics).length === 0) continue;

        const merged = {
          ...(row.engagement ?? {}),
          ...metrics,
          performance_score: score,
          synced_at: new Date().toISOString(),
        };

        await supabaseAdmin
          .from('content_distributions')
          .update({ engagement: merged })
          .eq('id', row.id);

        summary.updated += 1;

        if (score > 0) {
          performanceScores.push({ row, score });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.errors.push(`${row.id} (${row.platform}): ${msg}`);
      }
    }

    // 3. 성과 상위 20% → voice_samples 자동 append
    if (performanceScores.length > 0) {
      performanceScores.sort((a, b) => b.score - a.score);
      const topCount = Math.max(1, Math.floor(performanceScores.length * 0.2));
      const top = performanceScores.slice(0, topCount);

      for (const { row, score } of top) {
        if (score < 0.5) continue;  // 너무 낮으면 학습 안 함
        try {
          const content = extractContentFromPayload(row);
          if (!content) continue;
          const added = await appendVoiceSample('yeosonam', {
            platform: row.platform,
            content,
            performance_score: Math.round(score * 100) / 100,
            captured_at: new Date().toISOString().slice(0, 10),
          });
          if (added) summary.top_performers_added += 1;
        } catch (err) {
          summary.errors.push(`voice_sample ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`fatal: ${msg}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[sync-engagement]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return NextResponse.json({ ...summary, elapsed_ms: elapsedMs });
}

// ──────────────────────────────────────────────────────
// Instagram Graph API — Media Insights
// Docs: https://developers.facebook.com/docs/instagram-api/reference/ig-media/insights
// ──────────────────────────────────────────────────────
async function fetchInstagramMetrics(mediaId: string): Promise<Record<string, number> | null> {
  const accessToken = process.env.META_GRAPH_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const metrics = ['impressions', 'reach', 'saved', 'likes', 'comments', 'shares'].join(',');
    const url = `https://graph.facebook.com/v20.0/${mediaId}/insights?metric=${metrics}&access_token=${accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const result: Record<string, number> = {};
    for (const entry of (data.data ?? []) as Array<{ name: string; values: Array<{ value: number }> }>) {
      result[entry.name] = entry.values?.[0]?.value ?? 0;
    }
    return result;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────
// Meta Ads Insights — Ad 단위 CTR/Impressions
// Docs: https://developers.facebook.com/docs/marketing-api/insights
// ──────────────────────────────────────────────────────
async function fetchMetaAdsMetrics(adId: string): Promise<Record<string, number> | null> {
  const accessToken = process.env.META_ADS_ACCESS_TOKEN;
  if (!accessToken) return null;

  try {
    const fields = ['impressions', 'clicks', 'ctr', 'spend'].join(',');
    const url = `https://graph.facebook.com/v20.0/${adId}/insights?fields=${fields}&access_token=${accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const first = (data.data ?? [])[0] as Record<string, string | number> | undefined;
    if (!first) return null;
    return {
      impressions: Number(first.impressions ?? 0),
      clicks: Number(first.clicks ?? 0),
      ctr: Number(first.ctr ?? 0) / 100,  // Meta 는 % 단위
      spend: Number(first.spend ?? 0),
    };
  } catch {
    return null;
  }
}

function extractContentFromPayload(row: DistributionRow): string | null {
  const p = row.payload as Record<string, unknown>;
  if (row.platform === 'instagram_caption') return (p.caption as string) ?? null;
  if (row.platform === 'threads_post') {
    const main = (p.main as string) ?? '';
    const thread = (p.thread as string[]) ?? [];
    return [main, ...thread].join('\n\n');
  }
  if (row.platform === 'meta_ads') {
    const pt = (p.primary_texts as string[]) ?? [];
    return pt[0] ?? null;
  }
  if (row.platform === 'kakao_channel') return (p.message_text as string) ?? null;
  return null;
}
