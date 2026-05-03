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
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronLogging } from '@/lib/cron-observability';
import { indexPackage, indexBlog, indexAttraction, indexPolicy } from '@/lib/jarvis/rag/indexer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PER_RUN = 50;

async function handle(req: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (expected && auth !== expected) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // 1. 최근 변경된 패키지 (active/approved 만)
  const { data: pkgs } = await supabaseAdmin
    .from('travel_packages')
    .select('id, updated_at')
    .in('status', ['active', 'approved'])
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_RUN);

  // 2. 최근 발행된 블로그
  const { data: blogs } = await supabaseAdmin
    .from('content_creatives')
    .select('id, updated_at')
    .eq('status', 'published')
    .eq('channel', 'naver_blog')
    .not('slug', 'is', null)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_RUN);

  // 3. 최근 변경된 관광지 (long_desc 있는 것만)
  const { data: attrs } = await supabaseAdmin
    .from('attractions')
    .select('id, updated_at')
    .or('long_desc.not.is.null,short_desc.not.is.null')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_RUN);

  // 4. 최근 변경된 약관 (terms_templates)
  const { data: terms } = await supabaseAdmin
    .from('terms_templates')
    .select('id, updated_at')
    .eq('is_active', true)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(MAX_PER_RUN);

  const pkgResult = { inserted: 0, skipped: 0, failed: 0 };
  const blogResult = { inserted: 0, skipped: 0, failed: 0 };
  const attrResult = { inserted: 0, skipped: 0, failed: 0 };
  const policyResult = { inserted: 0, skipped: 0, failed: 0 };

  for (const p of pkgs ?? []) {
    const r = await indexPackage(p.id);
    pkgResult.inserted += r.inserted;
    pkgResult.skipped += r.skipped;
    pkgResult.failed += r.failed;
  }
  for (const b of blogs ?? []) {
    const r = await indexBlog(b.id);
    blogResult.inserted += r.inserted;
    blogResult.skipped += r.skipped;
    blogResult.failed += r.failed;
  }
  for (const a of attrs ?? []) {
    const r = await indexAttraction(a.id);
    attrResult.inserted += r.inserted;
    attrResult.skipped += r.skipped;
    attrResult.failed += r.failed;
  }
  for (const t of terms ?? []) {
    const r = await indexPolicy(t.id);
    policyResult.inserted += r.inserted;
    policyResult.skipped += r.skipped;
    policyResult.failed += r.failed;
  }

  return NextResponse.json({
    ok: true,
    window_hours: 24,
    packages: { scanned: pkgs?.length ?? 0, ...pkgResult },
    blogs: { scanned: blogs?.length ?? 0, ...blogResult },
    attractions: { scanned: attrs?.length ?? 0, ...attrResult },
    policies: { scanned: terms?.length ?? 0, ...policyResult },
  });
}

export const GET = withCronLogging('rag-incremental', handle);
