import { NextRequest, NextResponse } from 'next/server';
import {
  MARKETING_DEEP_SOURCE_TARGET,
  MARKETING_SOURCE_LEDGER_REVIEWS,
  type MarketingSourceLedgerReview,
} from '@/lib/marketing-deep-scorecard';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

function sanitizeSource(value: unknown): MarketingSourceLedgerReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const sourceUrl = String(row.source_url || '').trim();
  const sourceTitle = String(row.source_title || '').trim();
  if (!sourceUrl || !sourceTitle) return null;

  const sourceType = String(row.source_type);
  const channel = String(row.channel);
  const riskLevel = String(row.risk_level);

  return {
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_type: ['official_docs', 'release_notes', 'open_source', 'research', 'runbook'].includes(sourceType)
      ? sourceType as MarketingSourceLedgerReview['source_type']
      : 'official_docs',
    publisher: String(row.publisher || 'unknown').slice(0, 120),
    channel: ['google', 'meta', 'naver', 'kakao', 'seo', 'mcp', 'cross_channel'].includes(channel)
      ? channel as MarketingSourceLedgerReview['channel']
      : 'cross_channel',
    status: row.status === 'backlog' ? 'backlog' : 'accepted',
    accepted_capability: String(row.accepted_capability || 'Marketing automation evidence source.').slice(0, 1000),
    capability_tags: Array.isArray(row.capability_tags)
      ? row.capability_tags.map(String).slice(0, 12)
      : [],
    risk_level: ['low', 'medium', 'high'].includes(riskLevel)
      ? riskLevel as MarketingSourceLedgerReview['risk_level']
      : 'low',
    evidence: row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
      ? row.evidence as Record<string, unknown>
      : {},
  };
}

async function getReviewedSourceCount(): Promise<number> {
  if (!isSupabaseAdminConfigured) return 0;
  try {
    const { count, error } = await supabaseAdmin
      .from('ad_os_source_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'accepted');
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

export const GET = withAdminGuard(async () => {
  const currentSources = await getReviewedSourceCount();
  return NextResponse.json({
    ok: true,
    preview: true,
    target_sources: MARKETING_DEEP_SOURCE_TARGET,
    current_sources: currentSources,
    seed_sources: MARKETING_SOURCE_LEDGER_REVIEWS.length,
    ready: currentSources >= MARKETING_DEEP_SOURCE_TARGET,
    sources: MARKETING_SOURCE_LEDGER_REVIEWS,
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
    ? body.sources.map(sanitizeSource).filter(Boolean) as MarketingSourceLedgerReview[]
    : MARKETING_SOURCE_LEDGER_REVIEWS;

  if (!apply) {
    const currentSources = await getReviewedSourceCount();
    return NextResponse.json({
      ok: true,
      preview: true,
      target_sources: MARKETING_DEEP_SOURCE_TARGET,
      current_sources: currentSources,
      importable_sources: requestedSources.length,
      ready_after_import: currentSources + requestedSources.length >= MARKETING_DEEP_SOURCE_TARGET,
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

  const reviewedAt = new Date().toISOString();
  const ledgerRows = requestedSources.map((source) => ({
    source_url: source.source_url,
    source_title: source.source_title,
    source_type: source.source_type,
    publisher: source.publisher,
    channel: source.channel,
    status: source.status,
    accepted_capability: source.accepted_capability,
    risk_level: source.risk_level,
    reviewed_at: reviewedAt,
    evidence: {
      ...source.evidence,
      imported_by: 'ad_os_source_ledger_import_reviewed',
      external_api_write: false,
    },
  }));
  const { error: ledgerError } = await supabaseAdmin
    .from('ad_os_source_ledger')
    .upsert(ledgerRows as never, { onConflict: 'source_url' });
  if (ledgerError) return NextResponse.json({ ok: false, error: ledgerError.message }, { status: 500 });

  const reviewRows = requestedSources.map((source) => ({
    source_url: source.source_url,
    source_title: source.source_title,
    source_type: source.source_type,
    publisher: source.publisher,
    channel: source.channel,
    accepted_capability: source.accepted_capability,
    capability_tags: source.capability_tags,
    risk_level: source.risk_level,
    review_status: source.status,
    evidence: {
      ...source.evidence,
      external_api_write: false,
    },
    reviewed_at: reviewedAt,
  }));
  const { error: reviewError } = await supabaseAdmin
    .from('ad_os_source_ledger_reviews')
    .upsert(reviewRows as never, { onConflict: 'source_url' });
  if (reviewError) return NextResponse.json({ ok: false, error: reviewError.message }, { status: 500 });

  const currentSources = await getReviewedSourceCount();
  return NextResponse.json({
    ok: true,
    preview: false,
    imported_sources: requestedSources.length,
    current_sources: currentSources,
    target_sources: MARKETING_DEEP_SOURCE_TARGET,
    ready: currentSources >= MARKETING_DEEP_SOURCE_TARGET,
    safety: {
      read_only: false,
      database_mutation: true,
      external_api_write: false,
      live_spend_krw: 0,
    },
  });
});
