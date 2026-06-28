import { NextRequest, NextResponse } from 'next/server';
import {
  AD_OS_SOURCE_LEDGER_SEEDS,
  AD_OS_SOURCE_LEDGER_TARGET,
  type SourceLedgerSeed,
} from '@/lib/ad-os-ai-director';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function sanitizeSource(value: unknown): SourceLedgerSeed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceUrl = String(row.source_url || '').trim();
  const sourceTitle = String(row.source_title || '').trim();
  if (!sourceUrl || !sourceTitle) return null;
  return {
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_type: ['official_docs', 'release_notes', 'open_source', 'research', 'runbook'].includes(String(row.source_type))
      ? String(row.source_type) as SourceLedgerSeed['source_type']
      : 'official_docs',
    publisher: String(row.publisher || 'unknown').slice(0, 120),
    channel: ['google', 'meta', 'naver', 'kakao', 'seo', 'mcp', 'cross_channel'].includes(String(row.channel))
      ? String(row.channel) as SourceLedgerSeed['channel']
      : 'cross_channel',
    status: row.status === 'backlog' ? 'backlog' : 'accepted',
    accepted_capability: String(row.accepted_capability || 'Marketing automation evidence source.').slice(0, 1000),
    risk_level: ['low', 'medium', 'high'].includes(String(row.risk_level))
      ? String(row.risk_level) as SourceLedgerSeed['risk_level']
      : 'low',
  };
}

async function getCount() {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true });
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export const GET = withAdminGuard(async () => {
  const currentSources = await getCount();
  return NextResponse.json({
    ok: true,
    target_sources: AD_OS_SOURCE_LEDGER_TARGET,
    current_sources: currentSources,
    seed_sources: AD_OS_SOURCE_LEDGER_SEEDS,
    ready: currentSources >= AD_OS_SOURCE_LEDGER_TARGET,
    next_action: currentSources >= AD_OS_SOURCE_LEDGER_TARGET
      ? 'Source ledger target met.'
      : `Import and review ${AD_OS_SOURCE_LEDGER_TARGET - currentSources} additional sources.`,
    safety: {
      read_only: true,
      database_mutation: false,
      external_api_write: false,
      live_spend_krw: 0,
    },
  });
});

export const POST = withAdminGuard(async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const apply = body.apply === true;
  const requestedSources = Array.isArray(body.sources)
    ? body.sources.map(sanitizeSource).filter(Boolean) as SourceLedgerSeed[]
    : AD_OS_SOURCE_LEDGER_SEEDS;

  if (!apply) {
    const currentSources = await getCount();
    return NextResponse.json({
      ok: true,
      preview: true,
      target_sources: AD_OS_SOURCE_LEDGER_TARGET,
      current_sources: currentSources,
      importable_sources: requestedSources.length,
      sources: requestedSources,
      safety: {
        read_only: true,
        database_mutation: false,
        external_api_write: false,
        live_spend_krw: 0,
      },
    });
  }

  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase admin is not configured.' }, { status: 503 });
  }

  const rows = requestedSources.map((source) => ({
    ...source,
    reviewed_at: new Date().toISOString(),
    evidence: {
      imported_by: 'ad_os_source_ledger_import',
      external_api_write: false,
    },
  }));
  const { error } = await supabaseAdmin
    .from('ad_os_source_ledger')
    .upsert(rows as never, { onConflict: 'source_url' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const currentSources = await getCount();
  return NextResponse.json({
    ok: true,
    preview: false,
    imported_sources: rows.length,
    current_sources: currentSources,
    target_sources: AD_OS_SOURCE_LEDGER_TARGET,
    ready: currentSources >= AD_OS_SOURCE_LEDGER_TARGET,
    safety: {
      read_only: false,
      database_mutation: true,
      external_api_write: false,
      live_spend_krw: 0,
    },
  });
});
