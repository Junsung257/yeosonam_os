/**
 * Threads Content Generator — 매일 08:00 KST 실행 (Planner 완료 후)
 *
 * 역할:
 *   1. content_plans에서 status='planned', plan_date=오늘 항목 조회
 *   2. 각 계획의 category에 맞는 AI 프롬프트로 post 생성 (기존 generateThreadsPost 활용)
 *   3. 결과를 content_distributions에 저장 (status='ready')
 *   4. content_plans → distribution_id 연결
 *
 * 카테고리별 차별화 (Threads 전략 10K+ 분석 반영):
 *   - travel_tip: 교육형, 리스트, "이것만 알면"
 *   - product_promo: 오피니언+핫테이크, 긴급성
 *   - brand_story: 비하인드/프로세스, 1인칭
 *   - engagement: 질문형, 투표, 참여 유도
 *
 * 참고:
 *   - Threads 알고리즘: 첫 1시간 engagement velocity = 핵심
 *   - 40/30/20/10 비율 (opinion/behind/educational/question)
 *   - OpenTwins 7-stage pipeline의 Content Writer 단계
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { generateThreadsPost } from '@/lib/content-pipeline/agents/threads-post';
import { generateContentBrief } from '@/lib/content-pipeline/content-brief';
import { getRandomPexelsPhoto, isPexelsConfigured } from '@/lib/pexels';
import type { ContentBrief } from '@/lib/validators/content-brief';

export const runtime = 'nodejs';
export const maxDuration = 180; // 3분 — AI 생성 포함
export const dynamic = 'force-dynamic';

/** 간단한 문자열 해시 (중복 체크용) */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit int
  }
  return Math.abs(hash).toString(36).padStart(6, '0');
}

interface PlanRow {
  id: string;
  category: string;
  priority_score: number;
  product_id: string | null;
  trend_keyword: string | null;
}

interface PkgRow {
  id: string;
  title: string;
  destination: string | null;
  duration: number | null;
  nights: number | null;
  price: number | null;
  product_summary: string | null;
  product_highlights: string[] | null;
}

async function runGenerator(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정' };
  }

  const errors: string[] = [];
  const results: Array<{ plan_id: string; category: string; ok: boolean; distribution_id?: string; error?: string }> = [];

  // ── 1. 오늘 planned 항목 조회 ──────────────────────────────
  const today = new Date().toISOString().split('T')[0];

  const { data: plans, error: planErr } = await supabaseAdmin
    .from('content_plans')
    .select('id, category, priority_score, product_id, trend_keyword')
    .eq('plan_date', today)
    .eq('status', 'planned')
    .order('priority_score', { ascending: false });

  if (planErr) {
    return { skipped: true, reason: `계획 조회 실패: ${planErr.message}` };
  }
  const planRows = (plans ?? []) as unknown as PlanRow[];
  if (planRows.length === 0) {
    return { skipped: true, reason: '오늘 생성할 계획 없음' };
  }

  // ── 2. 카테고리별 angleType 매핑 (TrendStyle 엔진과 연동) ──
  const categoryToAngle: Record<string, 'budget' | 'luxury' | 'sentimental' | 'adventure' | undefined> = {
    travel_tip: 'budget',
    product_promo: 'adventure',
    brand_story: 'sentimental',
    engagement: undefined, // 기본 스타일 사용
  };

  const categoryToStyle: Record<string, 'personal_story' | 'info_list' | 'question' | 'behind_the_scene'> = {
    travel_tip: 'info_list',
    product_promo: 'personal_story',
    brand_story: 'behind_the_scene',
    engagement: 'question',
  };

  // ── 3. 계획에 연결된 상품 일괄 조회 (N+1 방지) ────────────────
  const productIds = [...new Set(planRows.map(p => p.product_id).filter(Boolean))] as string[];
  const pkgMap = new Map<string, PkgRow>();
  if (productIds.length > 0) {
    const { data: packages } = await supabaseAdmin
      .from('travel_packages')
      .select('id, title, destination, duration, nights, price, product_summary, product_highlights')
      .in('id', productIds);
    for (const p of packages ?? []) {
      pkgMap.set(p.id, p as unknown as PkgRow);
    }
  }

  // ── 4. 계획별 포스트 생성 ──────────────────────────────────
  for (const plan of planRows) {
    try {
      // 상품 정보 로드 (Map에서 O(1) 조회)
      const pkg: PkgRow | null = plan.product_id ? (pkgMap.get(plan.product_id) ?? null) : null;

      // ContentBrief 생성
      let brief: ContentBrief;
      if (pkg) {
        brief = await generateContentBrief({
          mode: 'product',
          slideCount: 6,
          product: {
            title: pkg.title ?? '',
            destination: pkg.destination ?? undefined,
            duration: pkg.duration ?? undefined,
            nights: pkg.nights ?? undefined,
            price: pkg.price ?? undefined,
            product_summary: pkg.product_summary ?? undefined,
            product_highlights: pkg.product_highlights ?? undefined,
          },
        });
      } else {
        // 상품 없으면 일반 여행 브리프
        brief = await generateContentBrief({
          mode: 'info',
          slideCount: 4,
          topic: plan.trend_keyword || '여행',
        });
      }

      // TrendStyle 엔진 적용 카테고리별 파라미터
      const angleType = categoryToAngle[plan.category];
      const style = categoryToStyle[plan.category];

      // 포스트 생성
      const productInput = pkg ? {
        title: pkg.title,
        destination: pkg.destination ?? undefined,
        duration: pkg.duration ?? undefined,
        nights: pkg.nights ?? undefined,
        price: pkg.price ?? undefined,
        product_summary: pkg.product_summary ?? undefined,
        product_highlights: pkg.product_highlights ?? undefined,
      } : undefined;

      const post = await generateThreadsPost({
        brief,
        product: productInput,
        style,
        trendKeywords: plan.trend_keyword ? [plan.trend_keyword] : undefined,
        angleType,
      });

      // ── 이미지 없으면 Pexels에서 추가 (Threads 2026 이미지 3x reach) ──
      if (!post.media_url && isPexelsConfigured()) {
        const destKw = pkg?.destination ?? '여행';
        const photo = await getRandomPexelsPhoto(destKw);
        if (photo) {
          post.media_url = photo.url;
        }
      }

      // ── 중복 방지: payload hash 기반 체크 (media_url 포함) ──
      const payloadHash = simpleHash(JSON.stringify(post));
      const { data: existingDupe } = await supabaseAdmin
        .from('content_distributions')
        .select('id')
        .eq('platform', 'threads_post')
        .in('status', ['ready', 'published'])
        .eq('generation_config->>payload_hash', payloadHash)
        .limit(1);

      if (existingDupe && existingDupe.length > 0) {
        // 중복이면 plan만 completed 처리 (distribution은 기존 것 참조)
        await supabaseAdmin
          .from('content_plans')
          .update({ status: 'completed', distribution_id: existingDupe[0].id })
          .eq('id', plan.id);
        createdCount++;
        continue;
      }

      // content_distributions에 저장 (status: ready)
      const now = new Date().toISOString();
      const row: Record<string, unknown> = {
        product_id: plan.product_id ?? null,
        platform: 'threads_post',
        payload: post,
        status: 'ready',
        generation_agent: 'threads-content-generator-v1',
        generation_config: {
          plan_id: plan.id,
          category: plan.category,
          brief,
          style,
          trendKeyword: plan.trend_keyword,
          angleType,
          payload_hash: payloadHash,
        },
        created_at: now,
        updated_at: now,
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('content_distributions')
        .insert(row)
        .select('id')
        .single();

      if (insErr || !inserted) {
        throw new Error(`content_distributions INSERT 실패: ${insErr?.message}`);
      }

      const distributionId = inserted.id as string;

      // content_plans 업데이트 → distribution_id 연결
      await supabaseAdmin
        .from('content_plans')
        .update({ status: 'completed', distribution_id: distributionId })
        .eq('id', plan.id);

      results.push({
        plan_id: plan.id,
        category: plan.category,
        ok: true,
        distribution_id: distributionId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[${plan.id}/${plan.category}] ${msg}`);

      // 실패한 plan은 cancelled 처리
      await supabaseAdmin
        .from('content_plans')
        .update({ status: 'cancelled' })
        .eq('id', plan.id);

      results.push({
        plan_id: plan.id,
        category: plan.category,
        ok: false,
        error: msg,
      });
    }
  }

  return {
    total_plans: planRows.length,
    success: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    details: results,
    errors: errors.length > 0 ? errors : undefined,
    ranAt: new Date().toISOString(),
  };
}

export const GET = withCronLogging('threads-content-generator', runGenerator);
