import { NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { getDashboardStats, isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

const getHandler = async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: 'Supabase가 설정되지 않았습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const { data, error } = await supabaseAdmin.rpc('get_admin_dashboard_stats');
  const stats = error ? await getDashboardStats() : data;
  return NextResponse.json(
    { stats },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
};

export const GET = withAdminGuard(getHandler);
