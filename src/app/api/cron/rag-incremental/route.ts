/**
 * GET /api/cron/rag-incremental — 매시간 자비스 RAG 누락 보호 (v5, 2026-04-30).
 *
 * 동작:
 *   1. 최근 24시간 내 변경된 packages/blogs/attractions 탐색
 *   2. jarvis_knowledge_chunks 에 없거나 content_hash 다른 항목만 인덱싱
 *   3. approve route / blog publisher hook 이 누락한 항목 보호
 *
 * 비용 보호:
 *   - 시간당 최대 50개 source 처리 (rate limit + 비용 cap)
 *   - 24시간 윈도우만 (오래된 변경은 batch script 로 처리)
 */
import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { indexPackage, indexBlog, indexAttraction, indexPolicy } from '@/lib/jarvis/rag/indexer';
import { apiResponse } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_PER_TYPE = 5;
const HARD_MAX_PER_TYPE = 20;
const DEADLINE_MS = 240_000;

function readPerTypeLimit(req: NextRequest): number {
  const raw = Number(req.nextUrl.searchParams.get('limit') || DEFAULT_PER_TYPE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_PER_TYPE;
  return Math.min(Math.floor(raw), HARD_MAX_PER_TYPE);
}

async function handle(req: NextRequest) {
  if (!isCronAuthorized(req)) return cronUnauthorizedResponse();
  if (!isSupabaseConfigured) return apiResponse({ skipped: true, reason: 'Supabase not configured' });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const perTypeLimit = readPerTypeLimit(req);
  const deadlineAt = Date.now() + DEADLINE_MS;

  // 1. 최근 변경된 패키지 (active/approved 만)
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('id, updated_at')
    .in('status', ['active', 'approved'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(perTypeLimit);

  // 2. 최근 발행된 블로그
  const { data: blogs } = await supabaseAdmin
    .from('content_creatives')
    .select('id, updated_at')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(perTypeLimit);

  // 3. 최근 변경된 관광지 (long_desc 있는 것만)
  const { data: attrs } = await supabaseAdmin
    .from('attractions')
    .select('id, updated_at')
    .or('long_desc.not.is.null,short_desc.not.is.null')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(perTypeLimit);

  // 4. 최근 변경된 약관 (terms_templates)
  const { data: terms } = await supabaseAdmin
    .from('terms_templates')
    .select('id, updated_at')
    .eq('is_active', true)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(perTypeLimit);

  const pkgResult = { inserted: 0, skipped: 0, failed: 0 };
  const blogResult = { inserted: 0, skipped: 0, failed: 0 };
  const attrResult = { inserted: 0, skipped: 0, failed: 0 };
  const policyResult = { inserted: 0, skipped: 0, failed: 0 };

  let truncated = false;

  async function runWithBudget(
    rows: Array<{ id: string }> | null | undefined,
    indexOne: (id: string) => Promise<{ inserted: number; skipped: number; failed: number }>,
    aggregate: { inserted: number; skipped: number; failed: number },
  ) {
    for (const row of rows ?? []) {
      if (Date.now() > deadlineAt) {
        truncated = true;
        break;
      }
      const r = await indexOne(row.id);
      aggregate.inserted += r.inserted;
      aggregate.skipped += r.skipped;
      aggregate.failed += r.failed;
    }
  }

  await runWithBudget(pkgs, indexPackage, pkgResult);
  await runWithBudget(blogs, indexBlog, blogResult);
  await runWithBudget(attrs, indexAttraction, attrResult);
  await runWithBudget(terms, indexPolicy, policyResult);

  return apiResponse({
    ok: true,
    truncated,
    per_type_limit: perTypeLimit,
    deadline_ms: DEADLINE_MS,
    window_hours: 24,
    packages: { scanned: pkgs?.length ?? 0, ...pkgResult },
    blogs: { scanned: blogs?.length ?? 0, ...blogResult },
    attractions: { scanned: attrs?.length ?? 0, ...attrResult },
    policies: { scanned: terms?.length ?? 0, ...policyResult },
  });
}

export const GET = withCronLogging('rag-incremental', handle);
