import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { destinationSlugMatches } from '@/lib/regions';

function isOptionalDestinationMetadataError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || /destination_metadata/i.test(error.message ?? '');
}

async function resolveDestinationRouteParam(city: string): Promise<string> {
  const decoded = decodeURIComponent(city).trim();
  if (!decoded || !isSupabaseConfigured) return decoded;

  try {
    const { data, error } = await supabaseAdmin
      .from('active_destinations')
      .select('destination')
      .limit(2000);
    if (error) return decoded;

    const match = ((data ?? []) as Array<{ destination: string | null }>)
      .map(row => row.destination?.trim() ?? '')
      .find(destination => destination && destinationSlugMatches(destination, decoded));

    return match || decoded;
  } catch {
    return decoded;
  }
}

export async function GET(_req: NextRequest, props: { params: Promise<{ city: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) return NextResponse.json({ data: null });
  const { city } = params;
  const destination = await resolveDestinationRouteParam(city);

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select('*')
    .eq('destination', destination)
    .eq('photo_approved', true)
    .maybeSingle();

  if (isOptionalDestinationMetadataError(error)) {
    return NextResponse.json({ data: null }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
    });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
  });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ city: string }> }) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  const { city } = params;
  const destination = await resolveDestinationRouteParam(city);

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

  const metadataPatch: Record<string, unknown> = {};
  if (body.tagline !== undefined) metadataPatch.tagline = body.tagline;
  if (body.hero_tagline !== undefined) metadataPatch.hero_tagline = body.hero_tagline;
  if (body.hero_image_url !== undefined) {
    metadataPatch.hero_image_url = body.hero_image_url;
    metadataPatch.photo_approved = false;
    metadataPatch.photo_approved_at = null;
    metadataPatch.photo_approval_source = null;
    metadataPatch.photo_quality_score = null;
    metadataPatch.photo_verification_evidence = null;
  }
  if (body.hero_image_pexels_id !== undefined) {
    metadataPatch.hero_image_pexels_id = body.hero_image_pexels_id;
  }
  if (body.hero_photographer !== undefined) {
    metadataPatch.hero_photographer = body.hero_photographer;
  }
  if (body.photo_approved !== undefined) {
    metadataPatch.photo_approved = body.photo_approved;
    metadataPatch.photo_approved_at = body.photo_approved ? new Date().toISOString() : null;
    metadataPatch.photo_approval_source = body.photo_approved ? 'owner_reviewed' : null;
    metadataPatch.photo_quality_score = body.photo_approved ? 1 : null;
    metadataPatch.photo_verification_evidence = body.photo_approved
      ? { reviewed_by_admin: true, reviewed_at: metadataPatch.photo_approved_at }
      : null;
  }

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .upsert({ destination, ...metadataPatch }, { onConflict: 'destination' })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(req: NextRequest, props: { params: Promise<{ city: string }> }) {
  const authError = await requireAdminRequest(req);
  if (authError) return authError;

  const params = await props.params;
  if (!isSupabaseConfigured) return NextResponse.json({ error: 'DB not configured' }, { status: 503 });
  const { city } = params;
  const destination = await resolveDestinationRouteParam(city);

  const { generateDestinationTaglines } = await import('@/lib/destination-setup');

  try {
    const { tagline, hero_tagline } = await generateDestinationTaglines(destination);

    const { data, error } = await supabaseAdmin
      .from('destination_metadata')
      .upsert({ destination, tagline, hero_tagline }, { onConflict: 'destination' })
      .select()
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return NextResponse.json(
      { data, generated: { tagline, hero_tagline } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '생성 실패' },
      { status: 500 }
    );
  }
}
