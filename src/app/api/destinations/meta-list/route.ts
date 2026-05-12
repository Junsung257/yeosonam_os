import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/** GET /api/destinations/meta-list — 전체 destination_metadata 목록 */
export async function GET() {
  if (!isSupabaseConfigured) return NextResponse.json({ data: [] });

  const { data, error } = await supabaseAdmin
    .from('destination_metadata')
    .select('destination, tagline, hero_tagline, hero_image_url, photo_approved');

  if (error) {
    if (error.message?.includes('does not exist') || error.message?.includes('schema cache')) {
      return NextResponse.json({ data: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
