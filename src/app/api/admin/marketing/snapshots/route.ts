import { type NextRequest, NextResponse } from 'next/server';
import { withAdminGuard } from '@/lib/admin-guard';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { withTimeout } from '@/lib/promise-timeout';

export const dynamic = 'force-dynamic';
const SNAPSHOT_TIMEOUT_MS = 8000;

interface SnapshotRow {
  captured_date: string;
  readiness_score: number | null;
  gsc_health_score: number | null;
  critical_actions: number | null;
  high_actions: number | null;
  active_campaigns: number | null;
  total_spend_krw: number | null;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

async function getHandler(request: NextRequest) {
  const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 14), 2), 60);
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  const sinceDate = since.toISOString().slice(0, 10);

  if (!isSupabaseConfigured) {
    return NextResponse.json({ snapshots: [], trend: [], skipped: 'Supabase is not configured' });
  }

  const { data, error } = await withTimeout(
    Promise.resolve(
      supabaseAdmin
        .from('marketing_asset_group_snapshots')
        .select('captured_date, readiness_score, gsc_health_score, critical_actions, high_actions, active_campaigns, total_spend_krw')
        .gte('captured_date', sinceDate)
        .order('captured_date', { ascending: true }),
    ),
    SNAPSHOT_TIMEOUT_MS,
    'marketing snapshots',
  ).catch((error) => ({
    data: [],
    error,
  }));

  if (error) {
    const missing = error.code === '42P01' || error.message.includes('marketing_asset_group_snapshots');
    return NextResponse.json({
      checked_at: new Date().toISOString(),
      days,
      snapshots: [],
      trend: [],
      summary: null,
      degraded: true,
      error: missing ? 'marketing_asset_group_snapshots migration is not applied yet' : error.message,
    });
  }

  const rows = (data ?? []) as SnapshotRow[];
  const byDate = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.captured_date) ?? [];
    list.push(row);
    byDate.set(row.captured_date, list);
  }

  const trend = Array.from(byDate.entries()).map(([date, dateRows]) => ({
    date,
    products: dateRows.length,
    avg_readiness: average(dateRows.map((row) => row.readiness_score ?? 0)),
    avg_gsc_health: average(dateRows.map((row) => row.gsc_health_score ?? 0)),
    critical_actions: sum(dateRows.map((row) => row.critical_actions ?? 0)),
    high_actions: sum(dateRows.map((row) => row.high_actions ?? 0)),
    active_campaigns: sum(dateRows.map((row) => row.active_campaigns ?? 0)),
    spend_krw: Math.round(sum(dateRows.map((row) => row.total_spend_krw ?? 0))),
  }));

  const first = trend[0];
  const latest = trend[trend.length - 1];

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    days,
    trend,
    summary: latest
      ? {
          latest,
          readiness_delta: first ? latest.avg_readiness - first.avg_readiness : 0,
          gsc_delta: first ? latest.avg_gsc_health - first.avg_gsc_health : 0,
        }
      : null,
  });
}

export const GET = withAdminGuard(getHandler);
