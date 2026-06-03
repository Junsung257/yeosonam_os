import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const [{ data: snapshots, error: snapshotError }, { data: alerts, error: alertError }] =
    await Promise.all([
      supabaseAdmin
        .from('seo_daily_snapshots')
        .select('*')
        .order('date', { ascending: false })
        .limit(14),
      supabaseAdmin
        .from('seo_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);

  const error = snapshotError ?? alertError;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    snapshots: snapshots ?? [],
    alerts: alerts ?? [],
  });
}
