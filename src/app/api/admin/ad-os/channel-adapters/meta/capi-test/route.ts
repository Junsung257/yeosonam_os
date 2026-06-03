import { NextRequest, NextResponse } from 'next/server';
import { buildMetaCapiTestPacket, type PacketSeed } from '@/lib/ad-os-v76-v85';
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
    eventName: body.event_name || body.eventName,
    eventId: body.event_id || body.eventId,
    valueKrw: body.value_krw || body.valueKrw,
    productId: body.product_id || body.productId,
    scenarioId: body.scenario_id || body.scenarioId,
  };

  return createPacketResponse({
    platform: 'meta',
    seed,
    apply: body.apply !== false,
    build: buildMetaCapiTestPacket,
  });
});
