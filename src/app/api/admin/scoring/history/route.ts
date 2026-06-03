/**
 * GET /api/admin/scoring/history?package_id=...&departure_date=YYYY-MM-DD
 *
 * 단일 패키지의 단일 출발일 시계열 (차트용).
 */
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withAdminGuard } from '@/lib/admin-guard';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getHandler = async (req: NextRequest) => {
  if (!isSupabaseConfigured) return apiResponse({ history: [] });
  const sp = req.nextUrl.searchParams;
  const packageId = sp.get('package_id');
  const departureDate = sp.get('departure_date');
  if (!packageId) return apiResponse({ error: 'package_id 필수' }, { status: 400 });

  let q = supabaseAdmin
    .from('package_score_history')
    .select('snapshot_date, rank_in_group, effective_price, group_size, list_price')
    .eq('package_id', packageId)
    .order('snapshot_date', { ascending: true });
  if (departureDate) q = q.eq('departure_date', departureDate);

  const { data, error } = await q;
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ history: data ?? [] });
}

export const GET = withAdminGuard(getHandler);
