import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { rateLimitMutation } from '@/lib/rate-limiter';
import { trackUserAction, type UserActionType } from '@/lib/user-actions';

const ACTION_TYPES = new Set<UserActionType>([
  'page_view',
  'package_view',
  'package_wish',
  'package_inquiry',
  'search',
]);

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return null;
  return trimmed;
}

function cleanLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6;
  return Math.max(1, Math.min(12, Math.floor(parsed)));
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitMutation(request);
  if (limited) return limited;

  if (!isSupabaseConfigured) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    const body = await request.json();
    const actionType = body?.actionType as UserActionType;
    if (!ACTION_TYPES.has(actionType)) {
      return NextResponse.json({ error: 'invalid_action_type' }, { status: 400 });
    }

    await trackUserAction({
      customerId: cleanId(body?.customerId),
      sessionId: cleanId(body?.sessionId),
      actionType,
      targetId: cleanId(body?.targetId),
      context: typeof body?.context === 'object' && body.context !== null ? body.context : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/user-actions] POST failed', error);
    return NextResponse.json({ error: 'failed_to_track' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ packages: [] });
  }

  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('mode');
  const limit = cleanLimit(searchParams.get('limit'));

  try {
    if (mode === 'similar') {
      const packageId = cleanId(searchParams.get('packageId'));
      if (!packageId) return NextResponse.json({ packages: [] });

      const { data: pkg } = await supabaseAdmin
        .from('travel_packages')
        .select('destination, category')
        .eq('id', packageId)
        .maybeSingle();

      if (!pkg) return NextResponse.json({ packages: [] });

      let query = supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price')
        .in('status', ['active', 'approved'])
        .neq('id', packageId)
        .limit(limit);

      if (pkg.destination) {
        query = query.eq('destination', pkg.destination);
      } else if (pkg.category) {
        query = query.eq('category', pkg.category);
      }

      const { data } = await query;
      return NextResponse.json({ packages: data ?? [] });
    }

    if (mode === 'recent') {
      const customerId = cleanId(searchParams.get('customerId'));
      const sessionId = cleanId(searchParams.get('sessionId'));
      if (!customerId && !sessionId) return NextResponse.json({ packages: [] });

      let actionsQuery = supabaseAdmin
        .from('user_actions')
        .select('target_id, created_at')
        .eq('action_type', 'package_view')
        .not('target_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      actionsQuery = customerId
        ? actionsQuery.eq('customer_id', customerId)
        : actionsQuery.eq('session_id', sessionId);

      const { data: actions } = await actionsQuery;
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const action of actions ?? []) {
        const id = action.target_id;
        if (typeof id === 'string' && !seen.has(id)) {
          seen.add(id);
          ids.push(id);
          if (ids.length >= limit) break;
        }
      }

      if (ids.length === 0) return NextResponse.json({ packages: [] });

      const { data } = await supabaseAdmin
        .from('travel_packages')
        .select('id, title, destination, price')
        .in('id', ids)
        .in('status', ['active', 'approved']);

      const order = new Map(ids.map((id, index) => [id, index]));
      const packages = (data ?? []).sort(
        (a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999),
      );
      return NextResponse.json({ packages });
    }

    return NextResponse.json({ packages: [] });
  } catch (error) {
    console.error('[api/user-actions] GET failed', error);
    return NextResponse.json({ packages: [] });
  }
}
