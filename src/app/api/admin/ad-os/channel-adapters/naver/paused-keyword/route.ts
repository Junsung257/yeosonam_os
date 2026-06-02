import { NextRequest, NextResponse } from 'next/server';
import { buildNaverPausedKeywordPacket, type PacketSeed } from '@/lib/ad-os-v76-v85';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured } from '@/lib/supabase';
import { createPacketResponse } from '../../_packet';

export const dynamic = 'force-dynamic';

export const POST = withAdminGuard(async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const seed: PacketSeed = {
    tenantId: body.tenant_id || body.tenantId || null,
    keyword: body.keyword,
    landingUrl: body.landing_url || body.landingUrl,
    headline: body.headline,
    description: body.description,
    maxCpcKrw: body.max_cpc_krw || body.maxCpcKrw,
    productId: body.product_id || body.productId,
    scenarioId: body.scenario_id || body.scenarioId,
  };

  return createPacketResponse({
    platform: 'naver',
    seed,
    apply: body.apply !== false,
    build: buildNaverPausedKeywordPacket,
  });
});
