import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';

interface StubBody {
  land_operator_id?: string;
  land_operator_name?: string;
  destination: string;
  price?: number;
  duration_nights?: number;
  departure_date?: string;
  title_hint?: string;
  source?: string;
  tenant_id?: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }

  let body: StubBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }

  if (!body.destination || body.destination.trim().length < 1) {
    return NextResponse.json({ error: 'destination 필수' }, { status: 400 });
  }
  if (!body.land_operator_id && !body.land_operator_name) {
    return NextResponse.json({ error: 'land_operator_id 또는 land_operator_name 중 하나 필수' }, { status: 400 });
  }

  let landOperatorId = body.land_operator_id ?? null;
  let landOperatorName = body.land_operator_name ?? null;

  if (!landOperatorId && landOperatorName) {
    const { data: existing } = await supabaseAdmin
      .from('land_operators')
      .select('id, name')
      .ilike('name', landOperatorName)
      .limit(1);

    if (existing && existing.length > 0) {
      const row = existing[0] as { id: string; name: string };
      landOperatorId = row.id;
      landOperatorName = row.name;
    } else {
      const { data: created, error: createErr } = await supabaseAdmin
        .from('land_operators')
        .insert({ name: landOperatorName, is_active: true })
        .select('id, name')
        .single();
      if (createErr || !created) {
        return NextResponse.json({
          error: '랜드사 자동 생성 실패',
          detail: createErr?.message,
        }, { status: 500 });
      }
      const row = created as { id: string; name: string };
      landOperatorId = row.id;
      landOperatorName = row.name;
    }
  }

  if (!landOperatorName && landOperatorId) {
    const { data } = await supabaseAdmin
      .from('land_operators')
      .select('name')
      .eq('id', landOperatorId)
      .limit(1);
    landOperatorName = (data?.[0] as { name?: string } | undefined)?.name ?? '랜드사미상';
  }

  const titleParts: string[] = [];
  if (body.destination) titleParts.push(body.destination);
  if (body.duration_nights) titleParts.push(`${body.duration_nights}박`);
  if (body.departure_date) titleParts.push(body.departure_date);
  if (body.price) titleParts.push(`${Math.round(body.price / 1000)}K`);
  if (landOperatorName) titleParts.push(`[${landOperatorName}]`);
  const title = body.title_hint?.trim() || `[STUB] ${titleParts.join(' ')}`;

  const fieldValues: Array<unknown> = [
    body.destination,
    body.price,
    body.duration_nights,
    body.departure_date,
    landOperatorId,
  ];
  const present = fieldValues.filter(v => v != null).length;
  const data_completeness = +(present / fieldValues.length).toFixed(2);

  const confirmedDates = body.departure_date ? [body.departure_date] : null;

  const { data: pkg, error } = await supabaseAdmin
    .from('travel_packages')
    .insert({
      title,
      destination: body.destination,
      price: body.price ?? null,
      nights: body.duration_nights ?? null,
      duration: body.duration_nights ? body.duration_nights + 1 : null,
      land_operator: landOperatorName,
      land_operator_id: landOperatorId,
      tenant_id: body.tenant_id ?? null,
      is_stub: true,
      stub_source: body.source ?? 'manual',
      data_completeness,
      status: 'stub',
      internal_notes: body.notes ?? null,
      confirmed_dates: confirmedDates,
      affiliate_commission_rate: 0,
      review_count: 0,
    })
    .select('id, title, destination, price, land_operator_id, is_stub')
    .single();

  if (error || !pkg) {
    return NextResponse.json({
      error: 'Stub 상품 생성 실패',
      detail: error?.message,
    }, { status: 500 });
  }

  return NextResponse.json({ success: true, package: pkg });
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ stubs: [] });
  }
  const { searchParams } = request.nextUrl;
  const destination = searchParams.get('destination');
  const land_operator_id = searchParams.get('land_operator_id');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);

  let query = supabaseAdmin
    .from('travel_packages')
    .select('id, title, destination, price, land_operator, land_operator_id, confirmed_dates, nights, data_completeness, created_at')
    .eq('is_stub', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (destination) query = query.ilike('destination', `%${destination}%`);
  if (land_operator_id) query = query.eq('land_operator_id', land_operator_id);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ stubs: data ?? [] });
}
