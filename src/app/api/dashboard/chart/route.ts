import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getDashboardStatsV3, isSupabaseConfigured } from '@/lib/supabase';

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500, headers: PRIVATE_NO_STORE },
    );
  }
  const { searchParams } = new URL(request.url);
  const months = Math.min(24, Math.max(1, parseInt(searchParams.get('months') || '6', 10)));
  const data = await getDashboardStatsV3(months);
  return NextResponse.json({ data }, { headers: PRIVATE_NO_STORE });
};

export const dynamic = 'force-dynamic';
export const GET = withAdminGuard(getHandler);
