import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isAdminRequest, resolveAdminActorLabel } from '@/lib/admin-guard';

/**
 * 발행 정책 관리 API (plural — admin-guarded)
 *   GET    /api/admin/publishing-policies            → 모든 정책
 *   GET    /api/admin/publishing-policies?scope=X    → 단일
 *   PATCH  /api/admin/publishing-policies            → 부분 업데이트 (scope 필수)
 *
 * 기존 /api/admin/publishing-policy (singular) 와 동일 테이블이지만,
 * admin-guard + bound 검증 + KPI 산식 friendly meta 응답을 추가한 버전.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = [
  'enabled',
  'posts_per_day',
  'per_destination_daily_cap',
  'slot_times',
  'product_ratio',
  'multi_angle_count',
  'multi_angle_gap_days',
  'auto_trigger_card_news',
  'auto_trigger_orchestrator',
  'auto_regenerate_underperformers',
  'daily_summary_webhook',
  'meta',
] as const;

type AllowedField = typeof ALLOWED_FIELDS[number];

const SLOT_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

function validateField(key: AllowedField, value: unknown): string | null {
  switch (key) {
    case 'enabled':
    case 'auto_trigger_card_news':
    case 'auto_trigger_orchestrator':
    case 'auto_regenerate_underperformers':
      if (typeof value !== 'boolean') return `${key} must be boolean`;
      return null;
    case 'posts_per_day': {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 50) {
        return 'posts_per_day must be integer in [1, 50]';
      }
      return null;
    }
    case 'per_destination_daily_cap': {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
        return 'per_destination_daily_cap must be integer in [1, 20]';
      }
      return null;
    }
    case 'multi_angle_count': {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) {
        return 'multi_angle_count must be integer in [1, 10]';
      }
      return null;
    }
    case 'multi_angle_gap_days': {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 30) {
        return 'multi_angle_gap_days must be integer in [1, 30]';
      }
      return null;
    }
    case 'product_ratio': {
      if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
        return 'product_ratio must be number in [0, 1]';
      }
      return null;
    }
    case 'slot_times': {
      if (!Array.isArray(value)) return 'slot_times must be string[]';
      if (value.length === 0) return 'slot_times must contain at least 1 entry';
      if (value.length > 24) return 'slot_times must contain at most 24 entries';
      for (const entry of value) {
        if (typeof entry !== 'string' || !SLOT_TIME_REGEX.test(entry)) {
          return `slot_times entry "${String(entry)}" must match HH:MM (24h)`;
        }
      }
      return null;
    }
    case 'daily_summary_webhook': {
      if (value === null || value === '') return null;
      if (typeof value !== 'string') return 'daily_summary_webhook must be string|null';
      if (!/^https:\/\//.test(value)) return 'daily_summary_webhook must start with https://';
      if (value.length > 2048) return 'daily_summary_webhook too long';
      return null;
    }
    case 'meta': {
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) return 'meta must be object';
      return null;
    }
    default:
      return `unknown field ${key}`;
  }
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return unauthorized();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ items: [], configured: false });
  }

  const scope = request.nextUrl.searchParams.get('scope');
  let query = supabaseAdmin
    .from('publishing_policies')
    .select('*')
    .order('scope', { ascending: true });
  if (scope) query = query.eq('scope', scope);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [], configured: true });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) return unauthorized();
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('invalid JSON body');
  }

  const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
  if (!scope) return badRequest('scope is required');

  const updates: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (!(key in body)) continue;
    const value = (body as Record<string, unknown>)[key];
    const err = validateField(key, value);
    if (err) return badRequest(err);
    // daily_summary_webhook: '' → null 정규화
    updates[key] = key === 'daily_summary_webhook' && value === '' ? null : value;
  }

  if (Object.keys(updates).length === 0) {
    return badRequest('no updatable fields supplied');
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('publishing_policies')
    .update(updates)
    .eq('scope', scope)
    .select()
    .limit(1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: `policy not found for scope=${scope}` }, { status: 404 });
  }

  const actor = await resolveAdminActorLabel(request);
  return NextResponse.json({
    item: data[0],
    actor,
    changed_fields: Object.keys(updates).filter((k) => k !== 'updated_at'),
  });
}
