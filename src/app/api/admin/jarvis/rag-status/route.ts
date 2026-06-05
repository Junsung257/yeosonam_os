/**
 * GET /api/admin/jarvis/rag-status
 *
 * Jarvis V2 RAG 인덱싱 상태 — chunk count + source별 분포 + 마지막 갱신일.
 * /admin/jarvis 페이지에 위젯 노출용.
 */
import { type NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { auditRagIndexRows, type RagIndexAuditRow } from '@/lib/jarvis/eval/rag-index-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) return apiResponse({ skipped: true });

  try {
    const [totalRes, sourceRes, latestRes, profileRes, sampleRes] = await Promise.all([
      supabaseAdmin.from('jarvis_knowledge_chunks').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('jarvis_knowledge_chunks').select('source_type'),
      supabaseAdmin.from('jarvis_knowledge_chunks').select('updated_at').order('updated_at', { ascending: false }).limit(1),
      supabaseAdmin.from('tenant_bot_profiles').select('id, bot_name, is_active'),
      supabaseAdmin.from('jarvis_knowledge_chunks')
        .select([
          'id',
          'tenant_id',
          'source_type',
          'source_id',
          'source_url',
          'source_title',
          'chunk_index',
          'chunk_text',
          'contextual_text',
          'content_hash',
          'updated_at',
        ].join(', '))
        .order('updated_at', { ascending: false })
        .limit(250),
    ]);

    const firstError = totalRes.error ?? sourceRes.error ?? latestRes.error ?? profileRes.error ?? sampleRes.error;
    if (firstError) throw firstError;

    const sources = (sourceRes.data ?? []).reduce((acc: Record<string, number>, r: Record<string, unknown>) => {
      const t = (r as { source_type: string }).source_type;
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});

    return apiResponse({
      total_chunks: totalRes.count ?? 0,
      by_source: sources,
      last_indexed_at: latestRes.data?.[0]?.updated_at ?? null,
      bot_profiles: (profileRes.data ?? []).length,
      rag_ready: (totalRes.count ?? 0) > 0,
      audit: auditRagIndexRows((sampleRes.data ?? []) as unknown as RagIndexAuditRow[]),
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to load Jarvis RAG status') },
      { status: 500 },
    );
  }
}

export const GET = withAdminGuard(getHandler);
