import { NextRequest } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { rateLimitMutation } from '@/lib/rate-limiter';
import { getSimilarPackages, trackUserAction, type UserActionType } from '@/lib/user-actions';
import { normalizeCustomerVisibleCopy } from '@/lib/customer-copy-quality';
import { listPublicCatalog, type PublicCatalogItem } from '@/lib/public-catalog';
import { apiResponse } from '@/lib/api-response';

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

function toPublicPackageCards(
  rows: PublicCatalogItem[],
  order?: Map<string, number>,
): Array<Record<string, unknown>> {
  const sorted = order
    ? [...rows].sort(
        (a, b) => (order.get(String(a.id)) ?? 999) - (order.get(String(b.id)) ?? 999),
      )
    : rows;
  return sorted.map((item) => ({
    id: item.id,
    slug: item.slug,
    title: normalizeCustomerVisibleCopy(item.title),
    destination: normalizeCustomerVisibleCopy(item.destination ?? ''),
    duration: item.duration,
    nights: item.nights,
    price: item.price,
    price_display: item.priceDisplay,
    hero_image: item.heroImage,
    available_dates: item.availableDates,
    badges: item.badges,
    booking_mode: item.bookingMode,
    last_verified_at: item.lastVerifiedAt,
  }));
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitMutation(request);
  if (limited) return limited;

  if (!isSupabaseConfigured) {
    return apiResponse({ ok: true, skipped: true });
  }

  try {
    const body = await request.json();
    const actionType = body?.actionType as UserActionType;
    if (!ACTION_TYPES.has(actionType)) {
      return apiResponse({ error: 'invalid_action_type' }, { status: 400 });
    }

    await trackUserAction({
      customerId: cleanId(body?.customerId),
      sessionId: cleanId(body?.sessionId),
      actionType,
      targetId: cleanId(body?.targetId),
      context: typeof body?.context === 'object' && body.context !== null ? body.context : undefined,
    });

    return apiResponse({ ok: true });
  } catch (error) {
    console.error('[api/user-actions] POST failed', error);
    return apiResponse({ error: 'failed_to_track' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return apiResponse({ packages: [] });
  }

  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('mode');
  const limit = cleanLimit(searchParams.get('limit'));

  try {
    if (mode === 'similar') {
      const packageId = cleanId(searchParams.get('packageId'));
      if (!packageId) return apiResponse({ packages: [] });
      const similar = await getSimilarPackages(packageId, { limit });
      return apiResponse({ packages: similar });
    }

    if (mode === 'recent') {
      const customerId = cleanId(searchParams.get('customerId'));
      const sessionId = cleanId(searchParams.get('sessionId'));
      if (!customerId && !sessionId) return apiResponse({ packages: [] });

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

      if (ids.length === 0) return apiResponse({ packages: [] });

      const data = await listPublicCatalog(supabaseAdmin, { ids, limit: ids.length });
      const order = new Map(ids.map((id, index) => [id, index]));
      return apiResponse({ packages: toPublicPackageCards(data, order) });
    }

    return apiResponse({ packages: [] });
  } catch (error) {
    console.error('[api/user-actions] GET failed', error);
    return apiResponse({ packages: [] });
  }
}
