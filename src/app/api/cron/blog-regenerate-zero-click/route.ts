/**
 * @file /api/cron/blog-regenerate-zero-click
 *
 * 매주 월요일 새벽 1회 실행 (vercel.json schedule: "0 5 * * 1" — UTC 05:00 ≈ KST 월 14:00)
 *
 * 무엇을 하는가:
 *   1) rank_history 에서 최근 14일 동안 한 번도 노출되거나 클릭되지 않은 slug 추출
 *      (sum(impressions)=0 AND sum(clicks)=0)
 *   2) 해당 slug 가 content_creatives 에 published 상태로 존재하는지 확인
 *   3) blog_regenerate_log 의 cooldown(7일) 미경과 글은 스킵
 *   4) llm-gateway.ts `task='blog-generate'` 로 재생성 (DeepSeek primary)
 *   5) runQualityGates() 통과 시에만 본문 교체 + revalidatePath
 *   6) 통과/실패 모두 blog_regenerate_log 에 기록 (감사용)
 *
 * 보호:
 *   - MAX_BATCH=5 — Vercel 60s 한계에 맞춤 (재생성당 ~8~10s)
 *   - 게이트 실패 시 본문 미교체 (구버전 유지) — 페이지 깨짐 방지
 *   - product_id NOT NULL 글(상품 랜딩)은 자동 재생성 대상에서 제외 — 마케터 의도된 카피이므로
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { runQualityGates } from '@/lib/blog-quality-gate';
import { llmCall } from '@/lib/llm-gateway';
import { withCronLogging } from '@/lib/cron-observability';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;
const COOLDOWN_DAYS = 7;
const MAX_BATCH = 5;

interface RankRow {
  slug: string;
  impressions: number | null;
  clicks: number | null;
}

interface RegenResult {
  slug: string;
  status: 'replaced' | 'gate_failed' | 'cooldown' | 'no_post' | 'llm_failed' | 'error';
  gateSummary?: string;
  reason?: string;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function regenerateBlogBody(seoTitle: string, destination: string | null): Promise<string | null> {
  const systemPrompt = `너는 한국어 여행 SEO 블로거다. 검색자의 의도에 직답하는 마크다운 글을 작성한다.
규칙:
- 본문 1,800~2,500자 (info 게이트 통과 기준)
- H1 1개 + H2 5~7개
- 첫 H2 안에 핵심 정의/한 줄 답 포함
- AI 클리셰 형용사 금지 ("아름다운","환상적인","완벽한","특별한" 등)
- 구체 수치(분/원/km/℃) 활용
- 내부링크 최소 1개 (/packages 또는 /blog/...)
- 마지막에 "여소남" 브랜드 CTA 1줄
- 코드블록으로 감싸지 말 것`;

  const userPrompt = `다음 제목으로 블로그를 다시 작성하라.\n\n제목: ${seoTitle}\n${destination ? `목적지: ${destination}` : ''}\n\n이전 버전은 14일 동안 검색 노출 0회 — 검색자가 이 글을 찾지 못했다.\n새 버전은 검색 의도(longtail)에 더 직답하고, H2 구조를 명확히 한다.`;

  const result = await llmCall<string>({
    task: 'blog-generate',
    systemPrompt,
    userPrompt,
    temperature: 0.7,
    maxTokens: 4000,
  });

  if (!result.success || !result.rawText) return null;
  // 코드펜스 제거
  return result.rawText
    .replace(/^```markdown\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

async function runRegenerator(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }
  if (!isSupabaseConfigured) {
    return { skipped: true, reason: 'Supabase 미설정', errors: [] as string[] };
  }

  const errors: string[] = [];
  const results: RegenResult[] = [];

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000).toISOString().split('T')[0];
  const cooldownSince = new Date(Date.now() - COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();

  try {
    // 1) zero-click slug 후보 추출
    const { data: rankRows, error: rankErr } = await supabaseAdmin
      .from('rank_history')
      .select('slug, impressions, clicks')
      .gte('date', since);

    if (rankErr) {
      errors.push(`rank_history 조회 실패: ${rankErr.message}`);
      return { processed: 0, errors, results };
    }

    if (!rankRows || rankRows.length === 0) {
      return { processed: 0, message: 'rank_history 데이터 없음', errors };
    }

    const agg = new Map<string, { impressions: number; clicks: number }>();
    for (const row of rankRows as RankRow[]) {
      const slug = row.slug;
      if (!slug) continue;
      const cur = agg.get(slug) || { impressions: 0, clicks: 0 };
      cur.impressions += row.impressions ?? 0;
      cur.clicks += row.clicks ?? 0;
      agg.set(slug, cur);
    }

    const zeroSlugs = [...agg.entries()]
      .filter(([, v]) => v.impressions === 0 && v.clicks === 0)
      .map(([slug]) => slug)
      .slice(0, MAX_BATCH * 4); // cooldown 필터로 줄어들 것 대비 여유

    if (zeroSlugs.length === 0) {
      return { processed: 0, message: '14일 zero-impression slug 없음', errors };
    }

    // 2) cooldown 필터 — 최근 7일 내 재생성된 slug 제외
    const { data: cooldownRows } = await supabaseAdmin
      .from('blog_regenerate_log')
      .select('slug')
      .gte('created_at', cooldownSince)
      .in('slug', zeroSlugs);
    const cooldownSet = new Set((cooldownRows || []).map((r: { slug: string }) => r.slug));

    const candidateSlugs = zeroSlugs.filter(s => !cooldownSet.has(s)).slice(0, MAX_BATCH);
    if (candidateSlugs.length === 0) {
      return { processed: 0, message: '후보 모두 cooldown 중', errors };
    }

    // 3) content_creatives 매칭 — info 글(product_id NULL)만
    const { data: posts, error: postErr } = await supabaseAdmin
      .from('content_creatives')
      .select('id, slug, seo_title, blog_html, destination, angle_type, product_id, travel_packages(destination)')
      .in('slug', candidateSlugs)
      .eq('channel', 'naver_blog')
      .eq('status', 'published')
      .is('product_id', null);

    if (postErr) {
      errors.push(`content_creatives 조회 실패: ${postErr.message}`);
      return { processed: 0, errors, results };
    }

    const postBySlug = new Map<string, any>();
    for (const p of posts || []) postBySlug.set(p.slug, p);

    // 4) 슬러그별 재생성 시도
    for (const slug of candidateSlugs) {
      const post = postBySlug.get(slug);
      if (!post) {
        results.push({ slug, status: 'no_post', reason: 'published info 글 아님' });
        continue;
      }

      try {
        const newHtml = await regenerateBlogBody(post.seo_title || slug, post.destination ?? null);
        if (!newHtml) {
          await supabaseAdmin.from('blog_regenerate_log').insert({
            post_id: post.id,
            slug,
            old_html_hash: sha256(post.blog_html || ''),
            new_html_hash: null,
            reason: 'zero_click',
            gate_passed: false,
            gate_summary: 'llm_failed',
          });
          results.push({ slug, status: 'llm_failed' });
          errors.push(`${slug}: LLM 생성 실패`);
          continue;
        }

        const dest = (Array.isArray(post.travel_packages)
          ? post.travel_packages[0]?.destination
          : post.travel_packages?.destination) ?? post.destination ?? null;

        const qa = await runQualityGates({
          blog_html: newHtml,
          slug,
          destination: dest,
          angle_type: post.angle_type ?? null,
          blog_type: 'info',
          primary_keyword: dest,
          excludeContentCreativeId: post.id,
        });

        const oldHash = sha256(post.blog_html || '');
        const newHash = sha256(newHtml);

        if (!qa.passed) {
          await supabaseAdmin.from('blog_regenerate_log').insert({
            post_id: post.id,
            slug,
            old_html_hash: oldHash,
            new_html_hash: newHash,
            reason: 'zero_click',
            gate_passed: false,
            gate_summary: qa.summary.slice(0, 1000),
          });
          results.push({ slug, status: 'gate_failed', gateSummary: qa.summary });
          continue;
        }

        // 통과 — 본문 교체
        const { error: upErr } = await supabaseAdmin
          .from('content_creatives')
          .update({
            blog_html: newHtml,
            updated_at: new Date().toISOString(),
            quality_gate: qa,
          })
          .eq('id', post.id);

        if (upErr) {
          errors.push(`${slug} update 실패: ${upErr.message}`);
          await supabaseAdmin.from('blog_regenerate_log').insert({
            post_id: post.id,
            slug,
            old_html_hash: oldHash,
            new_html_hash: newHash,
            reason: 'zero_click',
            gate_passed: true,
            gate_summary: `DB 업데이트 실패: ${upErr.message}`.slice(0, 1000),
          });
          results.push({ slug, status: 'error', reason: upErr.message });
          continue;
        }

        await supabaseAdmin.from('blog_regenerate_log').insert({
          post_id: post.id,
          slug,
          old_html_hash: oldHash,
          new_html_hash: newHash,
          reason: 'zero_click',
          gate_passed: true,
          gate_summary: qa.summary.slice(0, 1000),
        });

        try { revalidatePath('/blog'); } catch { /* noop */ }
        try { revalidatePath(`/blog/${slug}`); } catch { /* noop */ }
        results.push({ slug, status: 'replaced' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${slug} fatal: ${msg}`);
        results.push({ slug, status: 'error', reason: msg });
      }
    }

    return {
      processed: candidateSlugs.length,
      replaced: results.filter(r => r.status === 'replaced').length,
      gate_failed: results.filter(r => r.status === 'gate_failed').length,
      results,
      errors,
      ranAt: new Date().toISOString(),
    };
  } catch (err) {
    errors.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    return { processed: 0, errors, results };
  }
}

export const GET = withCronLogging('blog-regenerate-zero-click', runRegenerator);
