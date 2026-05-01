/**
 * GET /api/admin/jarvis/rag-status
 *
 * Jarvis V2 RAG 인덱싱 상태 — chunk count + source별 분포 + 마지막 갱신일.
 * /admin/jarvis 페이지에 위젯 노출용.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ skipped: true });
  const [totalRes, sourceRes, latestRes, profileRes] = await Promise.all([
    supabaseAdmin.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('jarvis_knowledge_chunks').select('source_type'),
    supabaseAdmin.from('jarvis_knowledge_chunks').select('updated_at').order('updated_at', { ascending: false }).limit(1),
    supabaseAdmin.from('tenant_bot_profiles').select('id, bot_name, is_active'),
  ]);

  const sources = (sourceRes.data ?? []).reduce((acc: Record<string, number>, r: Record<string, unknown>) => {
    const t = (r as { source_type: string }).source_type;
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    total_chunks: totalRes.count ?? 0,
    by_source: sources,
    last_indexed_at: latestRes.data?.[0]?.updated_at ?? null,
    bot_profiles: (profileRes.data ?? []).length,
    rag_ready: (totalRes.count ?? 0) > 0,
  });
}
