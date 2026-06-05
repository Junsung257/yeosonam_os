import { type NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { auditRagIndexRows, type RagIndexAuditRow } from '@/lib/jarvis/eval/rag-index-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (): Promise<NextResponse> => {
  if (!isSupabaseConfigured) {
    return apiResponse({
      skipped: true,
      reason: 'Supabase is not configured.',
      actions: [],
    });
  }

  try {
    const { data, error, count } = await supabaseAdmin
      .from('jarvis_knowledge_chunks')
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
      ].join(', '), { count: 'exact' })
      .order('updated_at', { ascending: false })
      .limit(250);

    if (error) throw error;

    const audit = auditRagIndexRows((data ?? []) as unknown as RagIndexAuditRow[]);
    return apiResponse({
      skipped: false,
      mode: 'plan_only',
      sampled_rows: audit.sampledRows,
      total_rows: count ?? null,
      quality_score: audit.qualityScore,
      readiness_level: audit.readinessLevel,
      actions: audit.remediationActions,
      samples: audit.samples,
      cli_command: 'npm run audit:jarvis-rag',
      release_gate_command: 'npm run verify:jarvis-readiness:ci',
    });
  } catch (err) {
    return apiResponse(
      { error: sanitizeDbError(err, 'Failed to load Jarvis remediation plan') },
      { status: 500 },
    );
  }
};

export const GET = withAdminGuard(getHandler);
