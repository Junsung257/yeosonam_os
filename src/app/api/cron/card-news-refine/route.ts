/**
 * GET /api/cron/card-news-refine
 *
 * 주 1회 (매주 월요일 08:00 UTC) 성과 저조 카드뉴스 자동 재작성 루프.
 *
 * 로직 (Self-Refine + engagement feedback):
 *   1. 3~14일 전 발행 (ig_published_at) + ig_publish_status='published' 카드뉴스 스캔
 *   2. post_engagement_snapshots 최신 스냅샷의 performance_score 조회
 *   3. score < 0.30 (하위 성과) + 이미 refinement 된 적 없는 것 필터
 *   4. cover-critic 호출 (product_context + engagement 정보 주입)
 *   5. rewritten_variants 에서 'contrarian' 또는 최상위 angle 선택
 *   6. 새 card_news INSERT — slide[0] 만 교체, status='DRAFT' (사장님 승인 대기)
 *   7. generation_config.refinement = { source_id, reason, original_score, angle }
 *
 * 결과: 매주 "저성과 → 재작성본 DRAFT" 자동 생성. 사장님은 승인 후 재발행.
 *
 * 보호:
 *   - 한 base 카드뉴스에 대해 refinement 1회만 (중복 방지)
 *   - 주당 최대 5건 처리 (과도한 Gemini 호출 방지)
 *   - CRON_SECRET 필요
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { critiqueCover } from '@/lib/content-pipeline/agents/cover-critic';
import type { SlideV2 } from '@/lib/card-news/v2/types';
import { withCronLogging } from '@/lib/cron-observability';
import { onContentRefinementCreated } from '@/lib/task-hooks';

export const runtime = 'nodejs';
export const maxDuration = 300;

const WEEKLY_LIMIT = 5;
const SCORE_THRESHOLD = 0.30;     // 이 미만 = 저성과
const MIN_DAYS_AFTER_PUBLISH = 3; // 발행 후 최소 3일 데이터 필요
const MAX_DAYS_AFTER_PUBLISH = 14;

interface CardNewsRow {
  id: string;
  title: string;
  slides: unknown;
  package_id: string | null;
  generation_config: Record<string, unknown> | null;
  template_family: string | null;
  template_version: string | null;
  category_id: string | null;
  ig_post_id: string | null;
  ig_published_at: string | null;
  ig_publish_status: string | null;
  threads_post_id: string | null;
  threads_published_at: string | null;
  threads_publish_status: string | null;
}

async function runCardNewsRefine(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });

  const startedAt = Date.now();
  const summary = {
    candidates_checked: 0,
    refined: 0,
    skipped_no_score: 0,
    skipped_score_ok: 0,
    skipped_already_refined: 0,
    skipped_no_rewrite: 0,
    errors: [] as string[],
    refined_ids: [] as string[],
  };

  try {
    const now = Date.now();
    const afterPublishedFrom = new Date(now - MAX_DAYS_AFTER_PUBLISH * 24 * 60 * 60 * 1000).toISOString();
    const afterPublishedTo = new Date(now - MIN_DAYS_AFTER_PUBLISH * 24 * 60 * 60 * 1000).toISOString();

    // 1. 대상 후보 카드뉴스 — IG 또는 Threads 로 발행된 것
    // 두 플랫폼 중 하나라도 published 이면 engagement 데이터가 있음
    const { data, error } = await supabaseAdmin
      .from('card_news')
      .select('id, title, slides, package_id, generation_config, template_family, template_version, category_id, ig_post_id, ig_published_at, ig_publish_status, threads_post_id, threads_published_at, threads_publish_status')
      .or(
        `and(ig_publish_status.eq.published,ig_published_at.gte.${afterPublishedFrom},ig_published_at.lte.${afterPublishedTo}),` +
        `and(threads_publish_status.eq.published,threads_published_at.gte.${afterPublishedFrom},threads_published_at.lte.${afterPublishedTo})`,
      )
      .limit(100);
    if (error) throw error;

    const rows = (data ?? []) as CardNewsRow[];
    summary.candidates_checked = rows.length;

    let refinedCount = 0;
    for (const row of rows) {
      if (refinedCount >= WEEKLY_LIMIT) break;

      // 원본이 이미 재작성본을 가진 경우 (refinement_to_id 존재) → skip
      // 재작성본 자신인 경우 (refinement.from_id 존재) → skip (무한 루프 방지)
      const gc = row.generation_config ?? {};
      if (
        (gc as { refinement_to_id?: string }).refinement_to_id ||
        (gc as { refinement?: { from_id?: string } }).refinement?.from_id
      ) {
        summary.skipped_already_refined += 1;
        continue;
      }

      // 2. 최신 engagement 스냅샷
      const { data: snaps } = await supabaseAdmin
        .from('post_engagement_snapshots')
        .select('performance_score, views, reach, likes, comments, saves, shares, captured_at')
        .eq('card_news_id', row.id)
        .order('captured_at', { ascending: false })
        .limit(1);
      const latest = snaps?.[0] as Record<string, number | string> | undefined;
      if (!latest || latest.performance_score == null) {
        summary.skipped_no_score += 1;
        continue;
      }
      const score = Number(latest.performance_score);
      if (score >= SCORE_THRESHOLD) {
        summary.skipped_score_ok += 1;
        continue;
      }

      // 3. Product context 수집 (가격/하이라이트)
      let productContext: Parameters<typeof critiqueCover>[0]['product_context'] = undefined;
      if (row.package_id) {
        const { data: pkg } = await supabaseAdmin
          .from('travel_packages')
          .select('title, destination, price, product_highlights')
          .eq('id', row.package_id)
          .maybeSingle();
        if (pkg) {
          const p = pkg as Record<string, unknown>;
          productContext = {
            title: p.title as string,
            destination: p.destination as string | undefined,
            price: p.price as number | undefined,
            key_selling_points: p.product_highlights as string[] | undefined,
          };
        }
      }
      // engagement 정보를 key_selling_points 뒷부분에 참고용 문장으로 주입 (critic 이 더 공격적 재작성)
      const engagementHint = `기존 성과: score=${score.toFixed(2)}, views=${latest.views ?? 0}, likes=${latest.likes ?? 0}, saves=${latest.saves ?? 0}. 저성과 → 전면 재작성 필요.`;
      const ctx = productContext ?? { title: row.title };
      ctx.key_selling_points = [...(ctx.key_selling_points ?? []), engagementHint].slice(0, 5);

      // 4. cover-critic 호출
      const slides = Array.isArray(row.slides) ? (row.slides as SlideV2[]) : [];
      if (slides.length === 0) { summary.skipped_no_rewrite += 1; continue; }

      try {
        const critique = await critiqueCover({ cover: slides[0], product_context: ctx });
        // contrarian 또는 target_call angle 우선 선택
        const variants = critique.rewritten_variants ?? [];
        const preferredOrder = ['contrarian', 'target_call', 'loss_aversion', 'number_stat', 'price', 'question'] as const;
        let chosen = variants[0];
        for (const angle of preferredOrder) {
          const found = variants.find(v => v.angle === angle);
          if (found) { chosen = found; break; }
        }
        const fallback = critique.rewritten_cover;
        const headline = chosen?.headline || fallback?.headline || slides[0].headline;
        const body = chosen?.body || fallback?.body || slides[0].body;
        const eyebrow = chosen?.eyebrow || fallback?.eyebrow || slides[0].eyebrow || '';

        if (headline === slides[0].headline && body === slides[0].body) {
          summary.skipped_no_rewrite += 1;
          continue;
        }

        // 5. 새 card_news INSERT (slide[0] 만 교체)
        const newSlides = [...slides];
        newSlides[0] = { ...slides[0], headline, body, eyebrow };

        // 단일 소스 규칙:
        //   재작성본 card_news.generation_config.refinement = { from_id, reason, original_score, chosen_angle, refined_at }
        //   원본 card_news.generation_config.refinement_to_id = 재작성본.id  (역참조만)
        // → refinement 메타는 재작성본에만. 원본은 "내가 만든 재작성본" 포인터만.
        const refinementMeta = {
          from_id: row.id,
          reason: 'low_performance_score',
          original_score: score,
          chosen_angle: chosen?.angle ?? 'auto',
          refined_at: new Date().toISOString(),
        };
        const newGC = { ...gc, refinement: refinementMeta };

        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from('card_news')
          .insert({
            title: `${row.title} [재작성/${chosen?.angle ?? 'auto'}]`,
            status: 'DRAFT',
            slides: newSlides as never,
            card_news_type: row.package_id ? 'product' : 'info',
            package_id: row.package_id,
            template_family: row.template_family,
            template_version: row.template_version ?? 'v2',
            category_id: row.category_id,
            generation_config: newGC,
          })
          .select('id')
          .single();
        if (insertErr || !inserted) {
          summary.errors.push(`INSERT 실패 ${row.id}: ${insertErr?.message}`);
          continue;
        }

        // 원본에 역참조만 (refinement 메타는 재작성본만 보유)
        await supabaseAdmin
          .from('card_news')
          .update({
            generation_config: { ...gc, refinement_to_id: inserted.id } as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', row.id);

        summary.refined += 1;
        summary.refined_ids.push(inserted.id);
        refinedCount += 1;

        // Inbox federation (booking_tasks 확정 후 본문 채워짐 — 현재 no-op + 이벤트 로그)
        try {
          await onContentRefinementCreated({
            card_news_id: inserted.id,
            refined_from_id: row.id,
            reason: 'low_performance_score',
            original_score: score,
            chosen_angle: chosen?.angle,
          });
        } catch (e) {
          // federation 실패는 refine 성공에 영향 없음
          console.warn('[card-news-refine] task-hook 실패 (무시):', e instanceof Error ? e.message : e);
        }
      } catch (err) {
        summary.errors.push(`refine ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    summary.errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('[card-news-refine]', JSON.stringify({ ...summary, elapsed_ms: elapsedMs }));
  return { ...summary, elapsed_ms: elapsedMs };
}

export const GET = withCronLogging('card-news-refine', runCardNewsRefine);
