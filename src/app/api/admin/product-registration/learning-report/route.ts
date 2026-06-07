import { NextResponse, type NextRequest } from 'next/server';

import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { loadProductRegistrationLearningReport } from '@/lib/product-registration/learning-engine-report';

export const dynamic = 'force-dynamic';

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.max(1, Math.min(Math.floor(parsed), 1000));
}

function parseSince(searchParams: URLSearchParams): string | null {
  const since = searchParams.get('since');
  if (since && !Number.isNaN(Date.parse(since))) return new Date(since).toISOString();

  const days = Number(searchParams.get('days') ?? 30);
  const boundedDays = Number.isFinite(days) ? Math.max(1, Math.min(Math.floor(days), 180)) : 30;
  return new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000).toISOString();
}

export const GET = withAdminGuard(async (request: NextRequest) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const report = await loadProductRegistrationLearningReport({
      supabase: supabaseAdmin,
      isSupabaseConfigured,
      since: parseSince(searchParams),
      limit: parseLimit(searchParams.get('limit')),
      fullRegressionVerified: searchParams.get('verified') === '1',
    });

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: 'blocked',
        error: error instanceof Error ? error.message : 'product registration learning report unavailable',
        nextAction: 'Check product_registration_improvement_events migration and service-role read access.',
        safety: {
          readOnly: true,
          productionMutation: false,
          rawTextStored: false,
          promotionRequiresReview: true,
        },
      },
      { status: 503 },
    );
  }
});
