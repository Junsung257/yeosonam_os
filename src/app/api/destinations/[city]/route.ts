import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(_req: NextRequest, { params }: { params: { city: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ data: null });
  const { city } = params;
  const destination = decodeURIComponent(city);

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select('*')
    .eq('destination', destination)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest, { params }: { params: { city: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  const { city } = params;
  const destination = decodeURIComponent(city);

  let body: {
    tagline?: string;
    hero_tagline?: string;
    photo_approved?: boolean;
    hero_image_url?: string;
    hero_image_pexels_id?: number;
    hero_photographer?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '유효하지 않은 JSON' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .upsert({ destination, ...body }, { onConflict: 'destination' })
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest, { params }: { params: { city: string } }) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  const { city } = params;
  const destination = decodeURIComponent(city);

  const { generateDestinationTaglines } = await import('@/lib/destination-setup');

  try {
    const { tagline, hero_tagline } = await generateDestinationTaglines(destination);

    const { data, error } = await supabaseAdmin
      .from('destination_metadata')
      .upsert({ destination, tagline, hero_tagline }, { onConflict: 'destination' })
      .select()
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data, generated: { tagline, hero_tagline } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 실패' },
      { status: 500 }
    );
  }
}
