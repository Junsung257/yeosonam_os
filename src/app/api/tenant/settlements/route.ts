import { NextRequest, NextResponse } from 'next/server';
import { getTenantSettlements, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/tenant/settlements?tenant_id=&month=YYYY-MM
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ rows: [], total_cost: 0 });
  const tenantId = request.nextUrl.searchParams.get('tenant_id');
  const month    = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  if (!tenantId) return NextResponse.json({ error: 'tenant_id 필수' }, { status: 400 });

  // 원가(cost)만 반환 — 판매가/마진/플랫폼 수수료는 절대 포함하지 않음
  const { rows, total_cost } = await getTenantSettlements(tenantId, month);
  return NextResponse.json({ rows, total_cost, month });
}
